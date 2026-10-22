import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { doneCommand } from '../src/commands/done.js';
import { getDb, closeDb } from '../src/db/connection.js';
import {
  upsertRepo,
  insertWorktree,
  insertPortAllocation,
  findActiveWorktreeByBranch,
  getActivePortAllocations
} from '../src/db/queries.js';
import { UsageError, WorktreeNotFoundError } from '../src/utils/errors.js';

describe('doneCommand', () => {
  let tempDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-done-test-'));
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

  it('throws UsageError if branch argument is missing', async () => {
    await expect(doneCommand('', { dbPath })).rejects.toThrow(UsageError);
  });

  it('throws WorktreeNotFoundError if worktree does not exist in registry', async () => {
    const cwd = process.cwd();
    upsertRepo(db, { rootPath: cwd, name: 'worktide' });

    await expect(doneCommand('non-existent-branch', { dbPath, cwd })).rejects.toThrow(
      WorktreeNotFoundError
    );
  });

  it('successfully tears down worktree and releases allocated ports', async () => {
    const cwd = process.cwd();
    const repo = upsertRepo(db, { rootPath: cwd, name: 'worktide' });
    const nonExistentPath = path.join(tempDir, 'non-existent-worktree');

    const wt = insertWorktree(db, {
      repoId: repo.id,
      branch: 'feature/done-test',
      slug: 'feature-done-test',
      path: nonExistentPath
    });

    insertPortAllocation(db, {
      worktreeId: wt.id,
      portStart: 3010,
      portEnd: 3019
    });

    // Before teardown
    expect(getActivePortAllocations(db).length).toBe(1);

    const result = await doneCommand('feature/done-test', { dbPath, cwd, force: true });
    expect(result.success).toBe(true);

    // After teardown
    const activeWt = findActiveWorktreeByBranch(db, repo.id, 'feature/done-test');
    expect(activeWt).toBeUndefined();

    const remainingAllocs = getActivePortAllocations(db);
    expect(remainingAllocs.length).toBe(0);
  });
});
