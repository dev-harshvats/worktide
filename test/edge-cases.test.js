import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { slugifyBranch } from '../src/utils/slug.js';
import { injectManagedBlock, extractManagedPorts, MANAGED_START } from '../src/services/env.js';
import {
  WorktideError,
  UsageError,
  GitError,
  WorktreeExistsError,
  WorktreeNotFoundError,
  DirtyWorktreeError,
  PortRangeExhaustedError,
  PortConflictError,
  ProcessTerminationError
} from '../src/utils/errors.js';
import { getDb, closeDb } from '../src/db/connection.js';
import { upsertRepo, insertWorktree, insertPortAllocation } from '../src/db/queries.js';
import { doctorCommand } from '../src/commands/doctor.js';

describe('Edge-Cases & Robustness Hardening', () => {
  let tempDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-edge-test-'));
    dbPath = path.join(tempDir, 'edge.db');
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

  describe('slugifyBranch edge cases', () => {
    it('handles deeply nested branch hierarchies', () => {
      expect(slugifyBranch('feat/team-a/ui/navbar/redesign')).toBe('feat-team-a-ui-navbar-redesign');
    });

    it('safely handles mixed punctuation and whitespace', () => {
      expect(slugifyBranch('  hotfix: v1.0.4 (urgent!)  ')).toBe('hotfix-v1.0.4-urgent');
      expect(slugifyBranch('feature_name_with_underscores')).toBe('feature-name-with-underscores');
    });
  });

  describe('managed env block edge cases', () => {
    it('handles corrupted or unclosed markers by appending cleanly', () => {
      const corrupted = `${MANAGED_START}\nPORT=3000\n`; // Missing end marker
      const result = injectManagedBlock(corrupted, 3010, 3019);

      expect(result).toContain('PORT=3010');
      expect(result).toContain('PORT_END=3019');
    });

    it('handles empty string content gracefully', () => {
      const result = injectManagedBlock('', 3000, 3009);
      expect(result).toContain('PORT=3000');
      const extracted = extractManagedPorts(result);
      expect(extracted).toEqual({ portStart: 3000, portEnd: 3009 });
    });
  });

  describe('domain error exit codes contract', () => {
    it('verifies explicit semantic exit codes across all error classes', () => {
      expect(new WorktideError('base').exitCode).toBe(1);
      expect(new UsageError('usage').exitCode).toBe(2);
      expect(new GitError('git').exitCode).toBe(10);
      expect(new WorktreeExistsError('exists').exitCode).toBe(11);
      expect(new WorktreeNotFoundError('notfound').exitCode).toBe(12);
      expect(new DirtyWorktreeError('dirty').exitCode).toBe(13);
      expect(new PortRangeExhaustedError().exitCode).toBe(20);
      expect(new PortConflictError('conflict').exitCode).toBe(21);
      expect(new ProcessTerminationError('procs').exitCode).toBe(30);
    });
  });

  describe('doctor handling multiple simultaneous anomalies', () => {
    it('heals orphaned records and stale locks in a single --fix pass', async () => {
      const mockRepoRoot = path.join(tempDir, 'mock-repo');
      const gitDir = path.join(mockRepoRoot, '.git');
      await fs.mkdir(gitDir, { recursive: true });

      // Stale lock
      const lockPath = path.join(gitDir, 'index.lock');
      await fs.writeFile(lockPath, '');
      const oldTime = new Date(Date.now() - 10 * 60 * 1000);
      await fs.utimes(lockPath, oldTime, oldTime);

      // Orphaned DB record
      const repo = upsertRepo(db, { rootPath: mockRepoRoot, name: 'mock-repo' });
      const orphanWt = insertWorktree(db, {
        repoId: repo.id,
        branch: 'orphan-1',
        slug: 'orphan-1',
        path: path.join(tempDir, 'does-not-exist')
      });
      insertPortAllocation(db, {
        worktreeId: orphanWt.id,
        portStart: 3010,
        portEnd: 3019
      });

      // Diagnose and heal in one execution
      const report = await doctorCommand({ dbPath, repoRoot: mockRepoRoot, fix: true });
      expect(report.healthy).toBe(true);
      expect(report.fixes.length).toBe(2);

      // Verify lock removed
      let lockExists = false;
      try {
        await fs.stat(lockPath);
        lockExists = true;
      } catch {
        lockExists = false;
      }
      expect(lockExists).toBe(false);
    });
  });
});
