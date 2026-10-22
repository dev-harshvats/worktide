import { getDb } from '../db/connection.js';
import {
  upsertRepo,
  findActiveWorktreeByBranch,
  insertWorktree,
  markWorktreeRemoved
} from '../db/queries.js';
import { allocatePortRange, releasePorts } from '../services/ports.js';
import { getRepoRoot, getRepoName, createWorktree, removeWorktree } from '../services/git.js';
import { symlinkNodeModules, copyEnvFiles } from '../services/sync.js';
import { writeManagedEnvLocal } from '../services/env.js';
import { slugifyBranch, getWorktreePath } from '../utils/slug.js';
import { logger } from '../utils/logger.js';
import { UsageError } from '../utils/errors.js';

/**
 * Handles the "worktide start <branch>" command.
 * Idempotently provisions a git worktree, symlinks dependencies, copies env files,
 * allocates a 10-port block, and guarantees atomic rollback on any failure.
 * 
 * @param {string} branch - Target branch name
 * @param {object} [options]
 * @param {string} [options.dbPath] - Optional custom DB path (for testing)
 * @param {string} [options.cwd] - Optional working directory override
 * @returns {Promise<object>} Result metadata
 */
export async function startCommand(branch, options = {}) {
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    throw new UsageError('Branch name is required: worktide start <branch>');
  }

  const cleanBranch = branch.trim();
  const cwd = options.cwd || process.cwd();

  // 1. Validate git repository
  const repoRoot = await getRepoRoot(cwd);
  const repoName = getRepoName(repoRoot);

  // 2. Connect to registry & ensure repo record
  const db = getDb(options.dbPath);
  const repo = upsertRepo(db, { rootPath: repoRoot, name: repoName });

  // 3. Check for existing active worktree (Idempotency requirement FR-9)
  const existing = findActiveWorktreeByBranch(db, repo.id, cleanBranch);
  if (existing) {
    logger.info(`Worktree already active at: ${existing.path}`);
    if (existing.port_start) {
      logger.info(`Allocated ports: ${existing.port_start}-${existing.port_end}`);
    }
    return {
      worktree: existing,
      alreadyActive: true,
      path: existing.path,
      portStart: existing.port_start,
      portEnd: existing.port_end
    };
  }

  // 4. Calculate target paths and slug
  const slug = slugifyBranch(cleanBranch);
  const targetPath = getWorktreePath(repoRoot, repoName, cleanBranch);

  const rollbacks = [];

  try {
    // Step A: Insert worktree record
    const worktree = insertWorktree(db, {
      repoId: repo.id,
      branch: cleanBranch,
      slug,
      path: targetPath
    });
    rollbacks.push(async () => {
      markWorktreeRemoved(db, worktree.id);
    });

    // Step B: Allocate port range
    const { portStart, portEnd } = await allocatePortRange(db, worktree.id, options);
    rollbacks.push(async () => {
      releasePorts(db, worktree.id);
    });

    // Step C: Create Git worktree
    await createWorktree({ targetPath, branch: cleanBranch, cwd: repoRoot });
    rollbacks.push(async () => {
      await removeWorktree(targetPath, { cwd: repoRoot, force: true });
    });

    // Step D: Symlink dependencies (if root node_modules exists)
    const { symlinked } = await symlinkNodeModules(repoRoot, targetPath);

    // Step E: Propagate environment files
    const copiedEnvs = await copyEnvFiles(repoRoot, targetPath);

    // Step F: Inject managed block into .env.local
    await writeManagedEnvLocal(targetPath, portStart, portEnd);

    // Output status
    logger.success(`Provisioned worktree at ${targetPath}`);
    logger.success(`Ports allocated: ${portStart}-${portEnd}`);
    if (symlinked) {
      logger.info('✓ Symlinked node_modules');
    }
    if (copiedEnvs.length > 0) {
      logger.info(`✓ Propagated environment files: ${copiedEnvs.join(', ')}`);
    }

    return {
      worktree,
      portStart,
      portEnd,
      targetPath,
      symlinked,
      copiedEnvs,
      alreadyActive: false
    };
  } catch (err) {
    // Atomic Rollback in reverse creation order (NFR-4)
    for (const rollback of rollbacks.reverse()) {
      try {
        await rollback();
      } catch (rollbackErr) {
        // Record rollback warning but preserve original error
        logger.warn(`Rollback warning: ${rollbackErr.message}`);
      }
    }
    throw err;
  }
}
