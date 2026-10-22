import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctorCommand } from '../src/commands/doctor.js';
import { getDb, closeDb } from '../src/db/connection.js';
import {
  upsertRepo,
  insertWorktree,
  insertPortAllocation,
  findActiveWorktreeByBranch,
  getActivePortAllocations
} from '../src/db/queries.js';

describe('doctorCommand', () => {
  let tempDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-doctor-test-'));
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

  it('reports healthy when no active worktrees or issues exist', async () => {
    const cwd = process.cwd();
    upsertRepo(db, { rootPath: cwd, name: 'worktide' });

    const report = await doctorCommand({ dbPath, cwd });
    expect(report.healthy).toBe(true);
    expect(report.issues.length).toBe(0);
  });

  it('detects and repairs orphaned registry allocations', async () => {
    const cwd = process.cwd();
    const repo = upsertRepo(db, { rootPath: cwd, name: 'worktide' });

    // Insert an active worktree whose directory does NOT exist on disk
    const missingPath = path.join(tempDir, 'ghost-worktree');
    const wt = insertWorktree(db, {
      repoId: repo.id,
      branch: 'ghost-branch',
      slug: 'ghost-branch',
      path: missingPath
    });
    insertPortAllocation(db, {
      worktreeId: wt.id,
      portStart: 3010,
      portEnd: 3019
    });

    // 1. Diagnostics without fix
    const report1 = await doctorCommand({ dbPath, cwd, fix: false });
    expect(report1.healthy).toBe(false);
    expect(report1.issues.some(i => i.type === 'orphaned_allocation')).toBe(true);
    expect(getActivePortAllocations(db).length).toBe(1);

    // 2. Diagnostics with --fix
    const report2 = await doctorCommand({ dbPath, cwd, fix: true });
    expect(report2.healthy).toBe(true);
    expect(report2.fixes.length).toBeGreaterThan(0);

    // DB record should be marked removed and ports released
    expect(findActiveWorktreeByBranch(db, repo.id, 'ghost-branch')).toBeUndefined();
    expect(getActivePortAllocations(db).length).toBe(0);
  });

  it('detects and cleans stale git locks', async () => {
    const mockRepoRoot = path.join(tempDir, 'mock-repo');
    const gitDir = path.join(mockRepoRoot, '.git');
    await fs.mkdir(gitDir, { recursive: true });

    const lockPath = path.join(gitDir, 'index.lock');
    await fs.writeFile(lockPath, '');

    // Set mtime to 5 minutes ago to simulate stale lock
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await fs.utimes(lockPath, fiveMinutesAgo, fiveMinutesAgo);

    upsertRepo(db, { rootPath: mockRepoRoot, name: 'mock-repo' });

    // Diagnose without fix
    const report1 = await doctorCommand({ dbPath, repoRoot: mockRepoRoot, fix: false });
    expect(report1.healthy).toBe(false);
    expect(report1.issues.some(i => i.type === 'stale_lock')).toBe(true);

    // Heal with --fix
    const report2 = await doctorCommand({ dbPath, repoRoot: mockRepoRoot, fix: true });
    expect(report2.healthy).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });
});
