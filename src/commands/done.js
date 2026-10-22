import { existsSync } from 'node:fs';
import { getDb } from '../db/connection.js';
import { getRepoByRoot, findActiveWorktreeByBranch, markWorktreeRemoved } from '../db/queries.js';
import { releasePorts } from '../services/ports.js';
import { getRepoRoot, removeWorktree, isWorktreeDirty } from '../services/git.js';
import { findPidsOnPorts, terminateProcesses } from '../services/procs.js';
import { logger } from '../utils/logger.js';
import { UsageError, WorktreeNotFoundError, DirtyWorktreeError } from '../utils/errors.js';

/**
 * Handles the "worktide done <branch> [--force]" command.
 * Verifies git cleanliness, terminates active processes on allocated ports,
 * removes the git worktree, and releases port records.
 * 
 * @param {string} branch - Branch name to tear down
 * @param {object} [options]
 * @param {boolean} [options.force] - Force teardown discarding uncommitted changes
 * @param {string} [options.dbPath] - Database path override (testing)
 * @param {string} [options.cwd] - Working directory override
 * @returns {Promise<object>}
 */
export async function doneCommand(branch, options = {}) {
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    throw new UsageError('Branch name is required: worktide done <branch>');
  }

  const cleanBranch = branch.trim();
  const cwd = options.cwd || process.cwd();

  // 1. Resolve Git repo and DB registry
  const repoRoot = await getRepoRoot(cwd);
  const db = getDb(options.dbPath);
  const repo = getRepoByRoot(db, repoRoot);

  if (!repo) {
    throw new WorktreeNotFoundError(`No repository found in registry for: ${repoRoot}`);
  }

  // 2. Find active worktree record
  const worktree = findActiveWorktreeByBranch(db, repo.id, cleanBranch);
  if (!worktree) {
    throw new WorktreeNotFoundError(`No active worktree found for branch: ${cleanBranch}`);
  }

  // 3. Git dirty check (require --force to override)
  if (!options.force && existsSync(worktree.path)) {
    const dirty = await isWorktreeDirty(worktree.path);
    if (dirty) {
      throw new DirtyWorktreeError(
        `Worktree at ${worktree.path} has uncommitted or untracked changes. Use --force to discard.`
      );
    }
  }

  // 4. Terminate active processes strictly on allocated ports
  if (worktree.port_start) {
    const pids = await findPidsOnPorts(worktree.port_start, worktree.port_end);
    if (pids.length > 0) {
      logger.info(`Terminating ${pids.length} process(es) on ports ${worktree.port_start}-${worktree.port_end}...`);
      await terminateProcesses(pids);
    }
  }

  // 5. Remove Git worktree from disk and prune git state
  if (existsSync(worktree.path)) {
    try {
      await removeWorktree(worktree.path, { cwd: repoRoot, force: true });
    } catch (err) {
      logger.warn(`Notice during worktree removal: ${err.message}`);
    }
  }

  // 6. Release ports and update registry status
  releasePorts(db, worktree.id);
  markWorktreeRemoved(db, worktree.id);

  logger.success(`Worktree for '${cleanBranch}' removed and ports released.`);

  return {
    success: true,
    branch: cleanBranch,
    worktreeId: worktree.id,
    portsReleased: worktree.port_start ? `${worktree.port_start}-${worktree.port_end}` : null
  };
}
