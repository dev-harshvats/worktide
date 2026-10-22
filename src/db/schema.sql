CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worktrees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  UNIQUE (repo_id, branch)
);

CREATE TABLE IF NOT EXISTS port_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worktree_id INTEGER NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  port_start INTEGER NOT NULL,
  port_end INTEGER NOT NULL CHECK (port_end >= port_start),
  allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT
);

-- Ensure no overlapping active port ranges across any repo
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_port_start 
  ON port_allocations(port_start) 
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_worktrees_repo 
  ON worktrees(repo_id, status);
