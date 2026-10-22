import net from 'node:net';
import { execa } from 'execa';
import { ProcessTerminationError } from '../utils/errors.js';

/**
 * Probes whether a process is actively listening on a port by attempting a TCP handshake.
 * 
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @param {number} [timeoutMs=300]
 * @returns {Promise<boolean>}
 */
export function checkPortLiveness(port, host = '127.0.0.1', timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = (isLive) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(isLive);
      }
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => cleanup(true));
    socket.once('timeout', () => cleanup(false));
    socket.once('error', () => cleanup(false));

    try {
      socket.connect(port, host);
    } catch {
      cleanup(false);
    }
  });
}

/**
 * Checks liveness for a worktree's port block.
 * Checks the primary port (portStart) first; returns 'live' if any port in the block is listening.
 * 
 * @param {number} portStart
 * @param {number} portEnd
 * @returns {Promise<'live' | 'down'>}
 */
export async function checkRangeLiveness(portStart, portEnd) {
  if (!portStart) return 'down';

  // Primary port check first
  const primaryLive = await checkPortLiveness(portStart);
  if (primaryLive) return 'live';

  // Check remaining ports in block
  const end = portEnd || portStart;
  for (let port = portStart + 1; port <= end; port++) {
    const isLive = await checkPortLiveness(port);
    if (isLive) return 'live';
  }

  return 'down';
}

/**
 * Discovers PIDs listening on ports in [portStart, portEnd].
 * Strictly scoped to the specified range to prevent killing unintended processes.
 * 
 * @param {number} portStart
 * @param {number} portEnd
 * @returns {Promise<number[]>} Unique array of PIDs
 */
export async function findPidsOnPorts(portStart, portEnd) {
  const pids = new Set();
  const isWin = process.platform === 'win32';

  if (!isWin) {
    try {
      // lsof -ti :3010-3019 -sTCP:LISTEN
      const portArg = portStart === portEnd ? `:${portStart}` : `:${portStart}-${portEnd}`;
      const { stdout } = await execa('lsof', ['-ti', portArg, '-sTCP:LISTEN']);
      for (const line of stdout.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0) {
          pids.add(pid);
        }
      }
    } catch {
      // lsof exits with 1 if no matching processes found
    }
  } else {
    // Windows fallback using netstat
    try {
      const { stdout } = await execa('netstat', ['-ano', '-p', 'tcp']);
      for (const line of stdout.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddr = parts[1];
          const colonIdx = localAddr.lastIndexOf(':');
          if (colonIdx !== -1) {
            const port = parseInt(localAddr.slice(colonIdx + 1), 10);
            const pid = parseInt(parts[4], 10);
            if (port >= portStart && port <= portEnd && !isNaN(pid) && pid > 0) {
              pids.add(pid);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(pids);
}

/**
 * Checks if a PID is alive.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // Process exists but owned by another user
  }
}

/**
 * Gracefully terminates processes: SIGTERM -> wait up to timeoutMs -> SIGKILL.
 * 
 * @param {number[]} pids
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<void>}
 */
export async function terminateProcesses(pids, { timeoutMs = 3000 } = {}) {
  const activePids = pids.filter(isProcessAlive);
  if (activePids.length === 0) return;

  // Phase 1: Send SIGTERM
  for (const pid of activePids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may have exited immediately
    }
  }

  // Phase 2: Poll for exit up to timeoutMs
  const startTime = Date.now();
  let remaining = activePids.filter(isProcessAlive);

  while (remaining.length > 0 && (Date.now() - startTime) < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = remaining.filter(isProcessAlive);
  }

  // Phase 3: Send SIGKILL to stubborn processes
  if (remaining.length > 0) {
    for (const pid of remaining) {
      try {
        if (process.platform === 'win32') {
          await execa('taskkill', ['/F', '/PID', String(pid)]);
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        // Ignore
      }
    }

    // Brief grace period for SIGKILL
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillAlive = remaining.filter(isProcessAlive);
    if (stillAlive.length > 0) {
      throw new ProcessTerminationError(
        `Processes refused termination on allocated ports: ${stillAlive.join(', ')}`
      );
    }
  }
}
