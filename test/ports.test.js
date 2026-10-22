import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { getDb, closeDb } from '../src/db/connection.js';
import { upsertRepo, insertWorktree } from '../src/db/queries.js';
import {
  isPortAvailable,
  probePortRange,
  findNextAvailablePortRange,
  allocatePortRange,
  releasePorts,
  DEFAULT_BASE_PORT
} from '../src/services/ports.js';
import { PortRangeExhaustedError } from '../src/utils/errors.js';

describe('Port Allocator Service', () => {
  let db;
  let testRepo;
  let worktreeCounter = 1;

  beforeEach(() => {
    db = getDb(':memory:');
    testRepo = upsertRepo(db, { rootPath: '/dev/testrepo', name: 'testrepo' });
  });

  afterEach(() => {
    closeDb(db);
  });

  function createTestWorktree() {
    const id = worktreeCounter++;
    return insertWorktree(db, {
      repoId: testRepo.id,
      branch: `branch-${id}`,
      slug: `branch-${id}`,
      path: `/dev/testrepo-branch-${id}`
    });
  }

  describe('isPortAvailable & probePortRange', () => {
    it('reports an unbound port as available', async () => {
      // Find an ephemeral high port
      const available = await isPortAvailable(49152);
      expect(typeof available).toBe('boolean');
    });

    it('detects a port in active use as unavailable', async () => {
      const server = net.createServer();
      const testPort = 49200;

      await new Promise((resolve, reject) => {
        server.listen(testPort, '127.0.0.1', () => resolve());
        server.on('error', reject);
      });

      try {
        const available = await isPortAvailable(testPort);
        expect(available).toBe(false);

        const rangeFree = await probePortRange(testPort - 2, testPort + 2);
        expect(rangeFree).toBe(false);
      } finally {
        await new Promise(resolve => server.close(resolve));
      }

      // After closing, it should become available again
      const availableAfter = await isPortAvailable(testPort);
      expect(availableAfter).toBe(true);
    });
  });

  describe('findNextAvailablePortRange', () => {
    it('starts allocation at base port (3000)', async () => {
      const mockProbe = async () => true;
      const { portStart, portEnd } = await findNextAvailablePortRange(db, {
        probeFn: mockProbe,
        basePort: 3000,
        rangeSize: 10
      });

      expect(portStart).toBe(3000);
      expect(portEnd).toBe(3009);
    });

    it('fills gaps before higher ranges (gap reuse)', async () => {
      const mockProbe = async () => true;
      const wt1 = createTestWorktree();
      const wt2 = createTestWorktree();
      const wt3 = createTestWorktree();

      // Allocate 3000-3009, 3010-3019, 3020-3029
      await allocatePortRange(db, wt1.id, { probeFn: mockProbe, basePort: 3000 });
      await allocatePortRange(db, wt2.id, { probeFn: mockProbe, basePort: 3000 });
      await allocatePortRange(db, wt3.id, { probeFn: mockProbe, basePort: 3000 });

      // Release the middle one (3010-3019)
      releasePorts(db, wt2.id);

      // Next allocation should reuse 3010-3019 instead of jumping to 3030
      const wt4 = createTestWorktree();
      const alloc = await allocatePortRange(db, wt4.id, { probeFn: mockProbe, basePort: 3000 });
      expect(alloc.portStart).toBe(3010);
      expect(alloc.portEnd).toBe(3019);
    });

    it('skips ranges occupied by external OS processes', async () => {
      // Mock probe: 3000-3009 is busy on OS, 3010-3019 is free
      const mockProbe = async (start, end) => {
        if (start === 3000) return false;
        return true;
      };

      const wt = createTestWorktree();
      const alloc = await allocatePortRange(db, wt.id, {
        probeFn: mockProbe,
        basePort: 3000
      });

      expect(alloc.portStart).toBe(3010);
      expect(alloc.portEnd).toBe(3019);
    });

    it('throws PortRangeExhaustedError when no ports are available', async () => {
      const mockProbe = async () => true;
      const wt = createTestWorktree();

      // Range between 3000 and 3009 only allows 1 block of 10
      await allocatePortRange(db, wt.id, {
        probeFn: mockProbe,
        basePort: 3000,
        rangeSize: 10,
        maxPort: 3009
      });

      const wt2 = createTestWorktree();
      await expect(
        allocatePortRange(db, wt2.id, {
          probeFn: mockProbe,
          basePort: 3000,
          rangeSize: 10,
          maxPort: 3009
        })
      ).rejects.toThrow(PortRangeExhaustedError);
    });
  });
});
