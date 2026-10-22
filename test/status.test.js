import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { statusCommand } from '../src/commands/status.js';
import { getDb, closeDb } from '../src/db/connection.js';
import { upsertRepo, insertWorktree, insertPortAllocation } from '../src/db/queries.js';

describe('statusCommand', () => {
  let tempDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-status-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = getDb(dbPath);
  });

  afterEach(async () => {
    closeDb(db);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('returns empty array when no worktrees are active', async () => {
    const results = await statusCommand({ dbPath, all: true });
    expect(results).toEqual([]);
  });

  it('returns active worktrees with port ranges and down status when inactive', async () => {
    const repo = upsertRepo(db, { rootPath: '/dev/myrepo', name: 'myrepo' });
    const wt = insertWorktree(db, {
      repoId: repo.id,
      branch: 'feature/auth',
      slug: 'feature-auth',
      path: '/dev/myrepo-feature-auth'
    });
    insertPortAllocation(db, {
      worktreeId: wt.id,
      portStart: 3010,
      portEnd: 3019
    });

    const results = await statusCommand({ dbPath, all: true });
    expect(results.length).toBe(1);
    expect(results[0].branch).toBe('feature/auth');
    expect(results[0].ports).toBe('3010-3019');
    expect(results[0].status).toBe('down');
  });

  it('supports JSON output flag', async () => {
    const results = await statusCommand({ dbPath, all: true, json: true });
    expect(Array.isArray(results)).toBe(true);
  });
});
