import { getDb } from '../db/connection.js';
import { getRepoByRoot, listWorktreesByRepo, listAllWorktrees } from '../db/queries.js';
import { getRepoRoot } from '../services/git.js';
import { checkRangeLiveness } from '../services/procs.js';
import { logger } from '../utils/logger.js';

/**
 * Handles the "worktide status" command.
 * Displays active worktrees, assigned ports, and socket liveness status.
 * 
 * @param {object} [options]
 * @param {boolean} [options.json] - Output in JSON format
 * @param {boolean} [options.all] - List across all registered repositories
 * @param {string} [options.dbPath] - Database path override (testing)
 * @param {string} [options.cwd] - Working directory override
 * @returns {Promise<Array<object>>}
 */
export async function statusCommand(options = {}) {
  const db = getDb(options.dbPath);
  const cwd = options.cwd || process.cwd();

  let rawWorktrees = [];

  if (options.all) {
    rawWorktrees = listAllWorktrees(db, 'active');
  } else {
    try {
      const repoRoot = await getRepoRoot(cwd);
      const repo = getRepoByRoot(db, repoRoot);
      if (repo) {
        rawWorktrees = listWorktreesByRepo(db, repo.id, 'active');
      }
    } catch {
      // If not in a git repo, fall back to all worktrees
      rawWorktrees = listAllWorktrees(db, 'active');
    }
  }

  const results = [];
  for (const wt of rawWorktrees) {
    const liveness = await checkRangeLiveness(wt.port_start, wt.port_end);
    results.push({
      branch: wt.branch,
      slug: wt.slug,
      path: wt.path,
      ports: wt.port_start ? `${wt.port_start}-${wt.port_end}` : 'none',
      status: liveness,
      repo: wt.repo_name || undefined
    });
  }

  if (options.json) {
    logger.raw(JSON.stringify(results, null, 2));
    return results;
  }

  if (results.length === 0) {
    logger.info('No active worktrees registered.');
    return results;
  }

  // Format aligned terminal table
  renderTable(results);
  return results;
}

function renderTable(rows) {
  const headers = ['BRANCH', 'PORTS', 'STATUS', 'PATH'];
  const data = rows.map(r => [
    r.branch,
    r.ports,
    r.status,
    r.path
  ]);

  const colWidths = headers.map((h, i) => {
    return Math.max(h.length, ...data.map(row => (row[i] || '').length));
  });

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('   ');
  const dividerLine = colWidths.map(w => '-'.repeat(w)).join('   ');

  logger.raw(headerLine);
  logger.raw(dividerLine);

  for (const row of data) {
    const line = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('   ');
    logger.raw(line);
  }
}
