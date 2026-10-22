import { getDb } from '../db/connection.js';
import { getRepoByRoot, listWorktreesByRepo } from '../db/queries.js';
import { getRepoRoot } from '../services/git.js';
import { runDiagnostics, repairIssues } from '../services/doctor.js';
import { logger } from '../utils/logger.js';

/**
 * Handles the "worktide doctor [--fix]" command.
 * Inspects system health, broken symlinks, orphaned DB records, and stale locks.
 * Automatically heals discrepancies when --fix is provided.
 * 
 * @param {object} [options]
 * @param {boolean} [options.fix] - Automatically repair identified issues
 * @param {string} [options.dbPath] - Database path override (testing)
 * @param {string} [options.cwd] - Working directory override
 * @returns {Promise<object>} Diagnostic and repair report
 */
export async function doctorCommand(options = {}) {
  const cwd = options.cwd || process.cwd();
  const repoRoot = options.repoRoot || (await getRepoRoot(cwd));
  const db = getDb(options.dbPath);

  const repo = getRepoByRoot(db, repoRoot);
  const activeWorktrees = repo ? listWorktreesByRepo(db, repo.id, 'active') : [];

  const issues = await runDiagnostics({ db, repoRoot, activeWorktrees });

  if (issues.length === 0) {
    logger.success('All systems healthy. No issues detected across filesystem, git state, and registry.');
    return {
      healthy: true,
      issues: [],
      fixes: []
    };
  }

  if (options.fix) {
    const fixes = await repairIssues(issues, { db, repoRoot });
    for (const fix of fixes) {
      if (fix.success) {
        logger.success(`[FIXED] ${fix.description}`);
      } else {
        logger.error(`[FAILED] ${fix.description}`);
      }
    }
    logger.success('All repairable issues have been addressed.');
    return {
      healthy: true,
      issues,
      fixes
    };
  }

  // Report issues without fixing
  for (const issue of issues) {
    logger.warn(`[ISSUE] ${issue.message}`);
  }
  logger.info('\nRun `worktide doctor --fix` to automatically repair these issues.');

  return {
    healthy: false,
    issues,
    fixes: []
  };
}
