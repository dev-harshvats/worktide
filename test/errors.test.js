import { describe, it, expect } from 'vitest';
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

describe('Error classes', () => {
  it('WorktideError sets name, message, and default exitCode 1', () => {
    const err = new WorktideError('Base error');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WorktideError');
    expect(err.message).toBe('Base error');
    expect(err.exitCode).toBe(1);
  });

  it('all domain error subclasses assign expected exit codes', () => {
    expect(new UsageError('invalid args').exitCode).toBe(2);
    expect(new GitError('git failure').exitCode).toBe(10);
    expect(new WorktreeExistsError('already exists').exitCode).toBe(11);
    expect(new WorktreeNotFoundError('not found').exitCode).toBe(12);
    expect(new DirtyWorktreeError('dirty worktree').exitCode).toBe(13);
    expect(new PortRangeExhaustedError().exitCode).toBe(20);
    expect(new PortConflictError('port conflict').exitCode).toBe(21);
    expect(new ProcessTerminationError('kill failed').exitCode).toBe(30);
  });
});
