import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { checkPortLiveness, checkRangeLiveness, isProcessAlive } from '../src/services/procs.js';

describe('procs service', () => {
  it('detects an unused port as down', async () => {
    const isLive = await checkPortLiveness(49300);
    expect(isLive).toBe(false);
  });

  it('detects a listening port as live', async () => {
    const server = net.createServer();
    const testPort = 49301;

    await new Promise((resolve, reject) => {
      server.listen(testPort, '127.0.0.1', resolve);
      server.on('error', reject);
    });

    try {
      const isLive = await checkPortLiveness(testPort);
      expect(isLive).toBe(true);

      const rangeLiveness = await checkRangeLiveness(testPort, testPort + 5);
      expect(rangeLiveness).toBe('live');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    // Down after server closes
    const isLiveAfter = await checkPortLiveness(testPort);
    expect(isLiveAfter).toBe(false);
  });

  it('checks if process is alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(9999999)).toBe(false);
  });
});
