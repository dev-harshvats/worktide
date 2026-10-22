/**
 * Repository queries
 */

export function upsertRepo(db, { rootPath, name }) {
  const stmt = db.prepare(`
    INSERT INTO repos (root_path, name)
    VALUES (?, ?)
    ON CONFLICT(root_path) DO UPDATE SET name = excluded.name
    RETURNING *
  `);
  return stmt.get(rootPath, name);
}

export function getRepoByRoot(db, rootPath) {
  const stmt = db.prepare('SELECT * FROM repos WHERE root_path = ?');
  return stmt.get(rootPath);
}

export function getRepoById(db, id) {
  const stmt = db.prepare('SELECT * FROM repos WHERE id = ?');
  return stmt.get(id);
}

/**
 * Worktree queries
 */

export function findActiveWorktreeByBranch(db, repoId, branch) {
  const stmt = db.prepare(`
    SELECT w.*, p.port_start, p.port_end 
    FROM worktrees w
    LEFT JOIN port_allocations p ON p.worktree_id = w.id AND p.released_at IS NULL
    WHERE w.repo_id = ? AND w.branch = ? AND w.status = 'active'
  `);
  return stmt.get(repoId, branch);
}

export function findWorktreeByPath(db, targetPath) {
  const stmt = db.prepare(`
    SELECT w.*, p.port_start, p.port_end 
    FROM worktrees w
    LEFT JOIN port_allocations p ON p.worktree_id = w.id AND p.released_at IS NULL
    WHERE w.path = ?
  `);
  return stmt.get(targetPath);
}

export function insertWorktree(db, { repoId, branch, slug, path }) {
  const stmt = db.prepare(`
    INSERT INTO worktrees (repo_id, branch, slug, path, status)
    VALUES (?, ?, ?, ?, 'active')
    RETURNING *
  `);
  return stmt.get(repoId, branch, slug, path);
}

export function markWorktreeRemoved(db, worktreeId) {
  const stmt = db.prepare(`
    UPDATE worktrees 
    SET status = 'removed', removed_at = datetime('now') 
    WHERE id = ?
  `);
  stmt.run(worktreeId);
}

export function listWorktreesByRepo(db, repoId, status = 'active') {
  const stmt = db.prepare(`
    SELECT w.*, p.port_start, p.port_end 
    FROM worktrees w
    LEFT JOIN port_allocations p ON p.worktree_id = w.id AND p.released_at IS NULL
    WHERE w.repo_id = ? AND (? IS NULL OR w.status = ?)
    ORDER BY w.created_at ASC
  `);
  return stmt.all(repoId, status, status);
}

export function listAllWorktrees(db, status = 'active') {
  const stmt = db.prepare(`
    SELECT w.*, r.name as repo_name, r.root_path as repo_root, p.port_start, p.port_end 
    FROM worktrees w
    JOIN repos r ON r.id = w.repo_id
    LEFT JOIN port_allocations p ON p.worktree_id = w.id AND p.released_at IS NULL
    WHERE (? IS NULL OR w.status = ?)
    ORDER BY w.created_at ASC
  `);
  return stmt.all(status, status);
}

/**
 * Port allocation queries
 */

export function getActivePortAllocations(db) {
  const stmt = db.prepare(`
    SELECT * FROM port_allocations 
    WHERE released_at IS NULL 
    ORDER BY port_start ASC
  `);
  return stmt.all();
}

export function insertPortAllocation(db, { worktreeId, portStart, portEnd }) {
  const stmt = db.prepare(`
    INSERT INTO port_allocations (worktree_id, port_start, port_end)
    VALUES (?, ?, ?)
    RETURNING *
  `);
  return stmt.get(worktreeId, portStart, portEnd);
}

export function releasePortAllocation(db, worktreeId) {
  const stmt = db.prepare(`
    UPDATE port_allocations 
    SET released_at = datetime('now') 
    WHERE worktree_id = ? AND released_at IS NULL
  `);
  return stmt.run(worktreeId);
}

export function findPortAllocationByWorktree(db, worktreeId) {
  const stmt = db.prepare(`
    SELECT * FROM port_allocations 
    WHERE worktree_id = ? AND released_at IS NULL
  `);
  return stmt.get(worktreeId);
}
