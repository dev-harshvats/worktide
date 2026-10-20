import { describe, it, expect, vi } from 'vitest';
import { logger } from '../src/utils/logger.js';

describe('Logger', () => {
  it('directs normal info, success, and raw messages to stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('info message');
    expect(stdoutSpy).toHaveBeenCalledWith('info message\n');

    logger.success('success message');
    expect(stdoutSpy).toHaveBeenCalledWith('✓ success message\n');

    logger.raw('{"key":"value"}');
    expect(stdoutSpy).toHaveBeenCalledWith('{"key":"value"}\n');

    stdoutSpy.mockRestore();
  });

  it('directs warnings and errors to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.warn('warning message');
    expect(stderrSpy).toHaveBeenCalledWith('! warning message\n');

    logger.error('error message');
    expect(stderrSpy).toHaveBeenCalledWith('✗ error message\n');

    stderrSpy.mockRestore();
  });
});
