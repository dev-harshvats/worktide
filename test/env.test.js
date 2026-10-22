import { describe, it, expect } from 'vitest';
import {
  formatManagedBlock,
  injectManagedBlock,
  extractManagedPorts,
  MANAGED_START,
  MANAGED_END
} from '../src/services/env.js';

describe('env service', () => {
  it('formats managed block correctly', () => {
    const block = formatManagedBlock(3010, 3019);
    expect(block).toContain(MANAGED_START);
    expect(block).toContain('PORT=3010');
    expect(block).toContain('PORT_END=3019');
    expect(block).toContain(MANAGED_END);
  });

  it('injects managed block into empty content', () => {
    const result = injectManagedBlock('', 3010, 3019);
    expect(result).toBe(`${formatManagedBlock(3010, 3019)}\n`);
  });

  it('appends managed block to existing user environment variables', () => {
    const initial = 'DATABASE_URL=postgres://localhost/db\nAPI_KEY=secret123\n';
    const result = injectManagedBlock(initial, 3020, 3029);

    expect(result).toContain('DATABASE_URL=postgres://localhost/db');
    expect(result).toContain('API_KEY=secret123');
    expect(result).toContain('PORT=3020');
    expect(result).toContain('PORT_END=3029');
  });

  it('updates existing managed block in-place while strictly preserving other variables', () => {
    const initial = [
      '# Top comment',
      'FOO=bar',
      MANAGED_START,
      'PORT=3000',
      'PORT_END=3009',
      MANAGED_END,
      'BAZ=qux',
      '# Bottom comment'
    ].join('\n');

    const updated = injectManagedBlock(initial, 3050, 3059);

    expect(updated).toContain('# Top comment');
    expect(updated).toContain('FOO=bar');
    expect(updated).toContain('BAZ=qux');
    expect(updated).toContain('# Bottom comment');
    expect(updated).toContain('PORT=3050');
    expect(updated).toContain('PORT_END=3059');
    expect(updated).not.toContain('PORT=3000');
  });

  it('extracts managed ports accurately', () => {
    const content = [
      'CUSTOM=1',
      MANAGED_START,
      'PORT=3040',
      'PORT_END=3049',
      MANAGED_END
    ].join('\n');

    const extracted = extractManagedPorts(content);
    expect(extracted).toEqual({
      portStart: 3040,
      portEnd: 3049
    });
  });

  it('returns null when extracting from content without managed block', () => {
    const extracted = extractManagedPorts('DATABASE_URL=postgres://localhost/db');
    expect(extracted).toBeNull();
  });
});
