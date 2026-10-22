import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startCommand } from '../src/commands/start.js';
import { getDb, closeDb } from '../src/db/connection.js';
import { upsertRepo, insertWorktree, insertPortAllocation } from '../src/db/queries.js';
import { UsageError } from '../src/utils/errors.js';

describe('startCommand', () => {
  let tempDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-start-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = getDb(dbPath);
  });

  afterEach(async () => {
    closeDb(db);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('throws UsageError if branch is missing or whitespace', async () => {
    await expect(startCommand('', { dbPath })).rejects.toThrow(UsageError);
    await expect(startCommand('   ', { dbPath })).rejects.toThrow(UsageError);
  });

  it('exits cleanly and returns existing record if branch is already active (idempotency)', async () => {
    const cwd = process.cwd();
    const repo = upsertRepo(db, { rootPath: cwd, name: 'worktide' });
    const worktree = insertWorktree(db, {
      repoId: repo.id,
      branch: 'feature/existing',
      slug: 'feature-existing',
      path: path.resolve(cwd, '../worktide-feature-existing')
    });
    insertPortAllocation(db, {
      worktreeId: worktree.id,
      portStart: 3010,
      portEnd: 3019
    });

    const result = await startCommand('feature/existing', { dbPath, cwd });
    expect(result.alreadyActive).toBe(true);
    expect(result.portStart).toBe(3010);
    expect(result.portEnd).toBe(3019);
  });
});
