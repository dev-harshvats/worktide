import fs from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { releasePorts } from './ports.js';
import { markWorktreeRemoved } from '../db/queries.js';
import { symlinkNodeModules } from './sync.js';
import { listGitWorktrees } from './git.js';

export const LOCK_STALE_AGE_MS = 60 * 1000; // 1 minute threshold

/**
 * Detects broken node_modules symlinks in active worktrees.
 * 
 * @param {Array<object>} worktrees
 * @param {string} repoRoot
 * @returns {Promise<Array<object>>}
 */
export async function diagnoseBrokenSymlinks(worktrees, repoRoot) {
  const issues = [];

  for (const wt of worktrees) {
    if (!existsSync(wt.path)) continue;

    const nmPath = path.join(wt.path, 'node_modules');
    if (!existsSync(nmPath)) {
      // Check if it's a broken symlink (lstat finds it, but stat/existsSync fails)
      try {
        const stat = lstatSync(nmPath);
        if (stat.isSymbolicLink()) {
          issues.push({
            type: 'broken_symlink',
            worktree: wt,
            path: nmPath,
            message: `Broken node_modules symlink in worktree '${wt.branch}' (${wt.path})`
          });
        }
      } catch {
        // Does not exist at all, not broken
      }
    } else {
      try {
        const stat = lstatSync(nmPath);
        if (stat.isSymbolicLink()) {
          const target = await fs.realpath(nmPath);
          if (!existsSync(target)) {
            issues.push({
              type: 'broken_symlink',
              worktree: wt,
              path: nmPath,
              message: `node_modules symlink in '${wt.branch}' points to non-existent path: ${target}`
            });
          }
        }
      } catch {
        issues.push({
          type: 'broken_symlink',
          worktree: wt,
          path: nmPath,
          message: `Unresolvable node_modules symlink in '${wt.branch}'`
        });
      }
    }
  }

  return issues;
}

/**
 * Detects worktrees recorded as active in SQLite whose path does not exist on disk
 * or is no longer tracked by Git.
 * 
 * @param {Array<object>} worktrees
 * @param {Array<object>} gitWorktrees
 * @returns {Array<object>}
 */
export function diagnoseOrphanedAllocations(worktrees, gitWorktrees = []) {
  const issues = [];
  const gitPaths = new Set(gitWorktrees.map(gw => path.resolve(gw.path)));

  for (const wt of worktrees) {
    const resolvedPath = path.resolve(wt.path);
    const diskExists = existsSync(resolvedPath);
    const gitRecognized = gitPaths.has(resolvedPath);

    if (!diskExists || !gitRecognized) {
      const reason = !diskExists
        ? 'Directory no longer exists on disk'
        : 'Directory is no longer recognized by git worktree';

      issues.push({
        type: 'orphaned_allocation',
        worktree: wt,
        message: `Orphaned registry record for '${wt.branch}' (${wt.path}): ${reason}`
      });
    }
  }

  return issues;
}

/**
 * Detects stale git index and worktree lock files.
 * 
 * @param {string} repoRoot
 * @param {number} [staleThresholdMs=LOCK_STALE_AGE_MS]
 * @returns {Promise<Array<object>>}
 */
export async function diagnoseStaleLocks(repoRoot, staleThresholdMs = LOCK_STALE_AGE_MS) {
  const issues = [];
  const now = Date.now();

  const candidateLockPaths = [
    path.join(repoRoot, '.git', 'index.lock')
  ];

  const gitWorktreesDir = path.join(repoRoot, '.git', 'worktrees');
  if (existsSync(gitWorktreesDir)) {
    try {
      const entries = await fs.readdir(gitWorktreesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidateLockPaths.push(path.join(gitWorktreesDir, entry.name, 'locked'));
          candidateLockPaths.push(path.join(gitWorktreesDir, entry.name, 'index.lock'));
        }
      }
    } catch {
      // Ignore
    }
  }

  for (const lockFile of candidateLockPaths) {
    if (existsSync(lockFile)) {
      try {
        const stat = await fs.stat(lockFile);
        const ageMs = now - stat.mtimeMs;
        if (ageMs > staleThresholdMs) {
          issues.push({
            type: 'stale_lock',
            path: lockFile,
            ageSeconds: Math.round(ageMs / 1000),
            message: `Stale git lock file found (${Math.round(ageMs / 1000)}s old): ${lockFile}`
          });
        }
      } catch {
        // File may have been removed concurrently
      }
    }
  }

  return issues;
}

/**
 * Runs full diagnostics across symlinks, orphaned registry records, and locks.
 * 
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {string} params.repoRoot
 * @param {Array<object>} params.activeWorktrees
 * @returns {Promise<Array<object>>}
 */
export async function runDiagnostics({ db, repoRoot, activeWorktrees }) {
  let gitWorktrees = [];
  try {
    gitWorktrees = await listGitWorktrees(repoRoot);
  } catch {
    // If not in a git repo
  }

  const [symlinkIssues, staleLockIssues] = await Promise.all([
    diagnoseBrokenSymlinks(activeWorktrees, repoRoot),
    diagnoseStaleLocks(repoRoot)
  ]);

  const orphanIssues = diagnoseOrphanedAllocations(activeWorktrees, gitWorktrees);

  return [...symlinkIssues, ...orphanIssues, ...staleLockIssues];
}

/**
 * Executes automated self-healing repairs for identified issues.
 * 
 * @param {Array<object>} issues
 * @param {object} context
 * @param {import('better-sqlite3').Database} context.db
 * @param {string} context.repoRoot
 * @returns {Promise<Array<object>>}
 */
export async function repairIssues(issues, { db, repoRoot }) {
  const fixes = [];

  for (const issue of issues) {
    if (issue.type === 'broken_symlink') {
      try {
        try {
          await fs.unlink(issue.path);
        } catch {
          // ignore
        }
        await symlinkNodeModules(repoRoot, issue.worktree.path);
        fixes.push({
          type: issue.type,
          success: true,
          description: `Re-created node_modules symlink for branch '${issue.worktree.branch}'`
        });
      } catch (err) {
        fixes.push({
          type: issue.type,
          success: false,
          description: `Failed to repair symlink in '${issue.worktree.branch}': ${err.message}`
        });
      }
    } else if (issue.type === 'orphaned_allocation') {
      try {
        releasePorts(db, issue.worktree.id);
        markWorktreeRemoved(db, issue.worktree.id);
        const portInfo = issue.worktree.port_start
          ? `ports ${issue.worktree.port_start}-${issue.worktree.port_end}`
          : 'ports';
        fixes.push({
          type: issue.type,
          success: true,
          description: `Released ${portInfo} and removed orphaned DB record for '${issue.worktree.branch}'`
        });
      } catch (err) {
        fixes.push({
          type: issue.type,
          success: false,
          description: `Failed to prune orphaned record for '${issue.worktree.branch}': ${err.message}`
        });
      }
    } else if (issue.type === 'stale_lock') {
      try {
        await fs.unlink(issue.path);
        fixes.push({
          type: issue.type,
          success: true,
          description: `Removed stale lock file: ${issue.path}`
        });
      } catch (err) {
        fixes.push({
          type: issue.type,
          success: false,
          description: `Failed to remove stale lock file ${issue.path}: ${err.message}`
        });
      }
    }
  }

  return fixes;
}
