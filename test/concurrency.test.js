import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDb, closeDb } from '../src/db/connection.js';
import { upsertRepo, insertWorktree, getActivePortAllocations } from '../src/db/queries.js';
import { allocatePortRange, releasePorts } from '../src/services/ports.js';

describe('Concurrency & Race Condition Hardening', () => {
  let tempDir;
  let dbPath;
  let db;
  let repo;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktide-concurrency-test-'));
    dbPath = path.join(tempDir, 'concurrency.db');
    db = getDb(dbPath);
    repo = upsertRepo(db, { rootPath: '/dev/app', name: 'app' });
  });

  afterEach(async () => {
    closeDb(db);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('handles simultaneous parallel port allocations without collision or lock contention', async () => {
    const mockProbe = async () => true;
    const workerCount = 10;

    // Create 10 worktrees
    const worktrees = [];
    for (let i = 1; i <= workerCount; i++) {
      const wt = insertWorktree(db, {
        repoId: repo.id,
        branch: `feature/worker-${i}`,
        slug: `feature-worker-${i}`,
        path: `/dev/app-worker-${i}`
      });
      worktrees.push(wt);
    }

    // Launch all allocations concurrently
    const allocationPromises = worktrees.map(wt => {
      // Each concurrent worker uses its own DB connection to simulate separate CLI processes
      const workerDb = getDb(dbPath);
      return allocatePortRange(workerDb, wt.id, {
        basePort: 3000,
        rangeSize: 10,
        probeFn: mockProbe
      }).finally(() => closeDb(workerDb));
    });

    const results = await Promise.all(allocationPromises);

    // Verify all 10 allocations are distinct
    const portStarts = results.map(r => r.portStart);
    const uniqueStarts = new Set(portStarts);
    expect(uniqueStarts.size).toBe(workerCount);

    // Verify every block is exactly 10 ports
    for (const r of results) {
      expect(r.portEnd - r.portStart).toBe(9);
    }

    // Verify database integrity
    const activeAllocs = getActivePortAllocations(db);
    expect(activeAllocs.length).toBe(workerCount);
  });

  it('reuses multiple interleaved released gaps under high churn', async () => {
    const mockProbe = async () => true;

    // Allocate 5 consecutive blocks: 3000, 3010, 3020, 3030, 3040
    const wts = [];
    for (let i = 0; i < 5; i++) {
      const wt = insertWorktree(db, {
        repoId: repo.id,
        branch: `branch-${i}`,
        slug: `branch-${i}`,
        path: `/dev/app-${i}`
      });
      await allocatePortRange(db, wt.id, { basePort: 3000, probeFn: mockProbe });
      wts.push(wt);
    }

    // Release index 1 (3010-3019) and index 3 (3030-3039)
    releasePorts(db, wts[1].id);
    releasePorts(db, wts[3].id);

    // Next two allocations must fill 3010 and 3030 in ascending order
    const newWt1 = insertWorktree(db, {
      repoId: repo.id,
      branch: 'fill-gap-1',
      slug: 'fill-gap-1',
      path: '/dev/app-fill-1'
    });
    const newWt2 = insertWorktree(db, {
      repoId: repo.id,
      branch: 'fill-gap-2',
      slug: 'fill-gap-2',
      path: '/dev/app-fill-2'
    });

    const alloc1 = await allocatePortRange(db, newWt1.id, { basePort: 3000, probeFn: mockProbe });
    const alloc2 = await allocatePortRange(db, newWt2.id, { basePort: 3000, probeFn: mockProbe });

    expect(alloc1.portStart).toBe(3010);
    expect(alloc2.portStart).toBe(3030);
  });
});
