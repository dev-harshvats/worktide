import net from 'node:net';
import { getActivePortAllocations, insertPortAllocation, releasePortAllocation } from '../db/queries.js';
import { PortRangeExhaustedError } from '../utils/errors.js';

export const DEFAULT_BASE_PORT = 3000;
export const DEFAULT_RANGE_SIZE = 10;
export const MAX_PORT = 65530;

/**
 * Checks if a single port is free to bind on localhost.
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', (err) => {
      resolve(false);
    });

    server.listen(port, host, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * Checks whether every port in [portStart, portEnd] is available on the OS.
 * @param {number} portStart
 * @param {number} portEnd
 * @param {string} [host='127.0.0.1']
 * @returns {Promise<boolean>}
 */
export async function probePortRange(portStart, portEnd, host = '127.0.0.1') {
  for (let port = portStart; port <= portEnd; port++) {
    const available = await isPortAvailable(port, host);
    if (!available) {
      return false;
    }
  }
  return true;
}

/**
 * Finds candidate port blocks and checks both the SQLite registry and OS availability.
 * Reuses released gaps (lowest free block first).
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {number} [options.basePort=3000]
 * @param {number} [options.rangeSize=10]
 * @param {number} [options.maxPort=65530]
 * @param {Function} [options.probeFn] - Custom probe function (for testing)
 * @returns {Promise<{ portStart: number, portEnd: number }>}
 */
export async function findNextAvailablePortRange(db, options = {}) {
  const basePort = options.basePort ?? DEFAULT_BASE_PORT;
  const rangeSize = options.rangeSize ?? DEFAULT_RANGE_SIZE;
  const maxPort = options.maxPort ?? MAX_PORT;
  const probe = options.probeFn ?? probePortRange;

  const activeAllocations = getActivePortAllocations(db);
  const occupiedRanges = activeAllocations.map(a => ({ start: a.port_start, end: a.port_end }));

  let candidateStart = basePort;

  while (candidateStart + rangeSize - 1 <= maxPort) {
    const candidateEnd = candidateStart + rangeSize - 1;

    // Check if candidate overlaps with any active allocation in DB
    const dbConflict = occupiedRanges.find(
      range => !(candidateEnd < range.start || candidateStart > range.end)
    );

    if (dbConflict) {
      // Advance to next block after this conflicting range
      candidateStart = Math.max(candidateStart + rangeSize, dbConflict.end + 1);
      // Align to rangeSize block boundary relative to basePort
      const offset = (candidateStart - basePort) % rangeSize;
      if (offset !== 0) {
        candidateStart += (rangeSize - offset);
      }
      continue;
    }

    // Verify OS-level availability (handles external non-WorkTide programs)
    const osFree = await probe(candidateStart, candidateEnd);
    if (!osFree) {
      candidateStart += rangeSize;
      continue;
    }

    return { portStart: candidateStart, portEnd: candidateEnd };
  }

  throw new PortRangeExhaustedError(
    `No available port range of size ${rangeSize} found between ${basePort} and ${maxPort}.`
  );
}

/**
 * Allocates a 10-port range for a worktree and records it in SQLite.
 * Handles concurrent attempts with retry on unique constraint collisions.
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {number} worktreeId
 * @param {object} [options]
 * @returns {Promise<{ portStart: number, portEnd: number, allocationId: number }>}
 */
export async function allocatePortRange(db, worktreeId, options = {}) {
  const maxRetries = options.maxRetries ?? 25;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { portStart, portEnd } = await findNextAvailablePortRange(db, options);

    try {
      const record = insertPortAllocation(db, {
        worktreeId,
        portStart,
        portEnd,
      });

      return {
        portStart: record.port_start,
        portEnd: record.port_end,
        allocationId: record.id,
      };
    } catch (err) {
      // If another process grabbed the exact same portStart concurrently
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        // Jitter backoff to avoid thundering herd contention
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25) + 5));
        continue;
      }
      throw err;
    }
  }

  throw new PortRangeExhaustedError('Failed to allocate port range after multiple concurrent attempts.');
}

/**
 * Releases the allocated port range for a worktree.
 * @param {import('better-sqlite3').Database} db
 * @param {number} worktreeId
 */
export function releasePorts(db, worktreeId) {
  return releasePortAllocation(db, worktreeId);
}
