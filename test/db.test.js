import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../src/db/connection.js';
import {
  upsertRepo,
  getRepoByRoot,
  getRepoById,
  insertWorktree,
  findActiveWorktreeByBranch,
  findWorktreeByPath,
  markWorktreeRemoved,
  listWorktreesByRepo,
  listAllWorktrees,
  insertPortAllocation,
  getActivePortAllocations,
  releasePortAllocation,
  findPortAllocationByWorktree
} from '../src/db/queries.js';

describe('SQLite Database & Queries', () => {
  let db;

  beforeEach(() => {
    db = getDb(':memory:');
  });

  afterEach(() => {
    closeDb(db);
  });

  it('initializes schema and tables correctly', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
    `).all().map(t => t.name);

    expect(tables).toContain('repos');
    expect(tables).toContain('worktrees');
    expect(tables).toContain('port_allocations');
  });

  it('enforces foreign key constraints', () => {
    expect(() => {
      insertWorktree(db, {
        repoId: 99999, // Non-existent repo
        branch: 'feat/test',
        slug: 'feat-test',
        path: '/tmp/test'
      });
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('upserts repos idempotently', () => {
    const repo1 = upsertRepo(db, { rootPath: '/dev/repo1', name: 'repo1' });
    expect(repo1.id).toBeDefined();
    expect(repo1.root_path).toBe('/dev/repo1');
    expect(repo1.name).toBe('repo1');

    // Second upsert should update name if needed and return same repo
    const repo2 = upsertRepo(db, { rootPath: '/dev/repo1', name: 'repo1-renamed' });
    expect(repo2.id).toBe(repo1.id);
    expect(repo2.name).toBe('repo1-renamed');

    const fetched = getRepoByRoot(db, '/dev/repo1');
    expect(fetched.name).toBe('repo1-renamed');
  });

  it('manages worktree lifecycle and queries', () => {
    const repo = upsertRepo(db, { rootPath: '/dev/repo1', name: 'repo1' });
    const worktree = insertWorktree(db, {
      repoId: repo.id,
      branch: 'feature/auth',
      slug: 'feature-auth',
      path: '/dev/repo1-feature-auth'
    });

    expect(worktree.id).toBeDefined();
    expect(worktree.status).toBe('active');

    // Retrieve active worktree
    const active = findActiveWorktreeByBranch(db, repo.id, 'feature/auth');
    expect(active).toBeDefined();
    expect(active.path).toBe('/dev/repo1-feature-auth');

    // Mark removed
    markWorktreeRemoved(db, worktree.id);
    const afterRemoval = findActiveWorktreeByBranch(db, repo.id, 'feature/auth');
    expect(afterRemoval).toBeUndefined();

    // Check by path
    const byPath = findWorktreeByPath(db, '/dev/repo1-feature-auth');
    expect(byPath.status).toBe('removed');
  });

  it('handles port allocations and cascade deletes', () => {
    const repo = upsertRepo(db, { rootPath: '/dev/repo1', name: 'repo1' });
    const worktree = insertWorktree(db, {
      repoId: repo.id,
      branch: 'feature/ports',
      slug: 'feature-ports',
      path: '/dev/repo1-ports'
    });

    const alloc = insertPortAllocation(db, {
      worktreeId: worktree.id,
      portStart: 3010,
      portEnd: 3019
    });

    expect(alloc.id).toBeDefined();
    expect(alloc.port_start).toBe(3010);
    expect(alloc.port_end).toBe(3019);

    // Active allocations list
    let activeAllocs = getActivePortAllocations(db);
    expect(activeAllocs.length).toBe(1);
    expect(activeAllocs[0].port_start).toBe(3010);

    // Prevents duplicate active portStart
    expect(() => {
      const worktree2 = insertWorktree(db, {
        repoId: repo.id,
        branch: 'feature/ports-2',
        slug: 'feature-ports-2',
        path: '/dev/repo1-ports-2'
      });
      insertPortAllocation(db, {
        worktreeId: worktree2.id,
        portStart: 3010, // duplicate
        portEnd: 3019
      });
    }).toThrow(/UNIQUE constraint failed/);

    // Release port allocation
    releasePortAllocation(db, worktree.id);
    activeAllocs = getActivePortAllocations(db);
    expect(activeAllocs.length).toBe(0);

    // Cascade delete on repo removal
    db.prepare('DELETE FROM repos WHERE id = ?').run(repo.id);
    const remainingWorktrees = db.prepare('SELECT * FROM worktrees').all();
    const remainingAllocs = db.prepare('SELECT * FROM port_allocations').all();
    expect(remainingWorktrees.length).toBe(0);
    expect(remainingAllocs.length).toBe(0);
  });
});
