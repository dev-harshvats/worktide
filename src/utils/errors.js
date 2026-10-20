/**
 * Base error class for all WorkTide domain errors.
 */
export class WorktideError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
  }
}

/**
 * Thrown when CLI invocation has invalid arguments or options.
 */
export class UsageError extends WorktideError {
  constructor(message) {
    super(message, 2);
  }
}

/**
 * Thrown when a git command fails or current directory is not a git repo.
 */
export class GitError extends WorktideError {
  constructor(message) {
    super(message, 10);
  }
}

/**
 * Thrown when attempting to start a worktree that is already active.
 */
export class WorktreeExistsError extends WorktideError {
  constructor(message) {
    super(message, 11);
  }
}

/**
 * Thrown when a worktree cannot be found in the registry or filesystem.
 */
export class WorktreeNotFoundError extends WorktideError {
  constructor(message) {
    super(message, 12);
  }
}

/**
 * Thrown when attempting to remove a worktree with uncommitted changes without --force.
 */
export class DirtyWorktreeError extends WorktideError {
  constructor(message) {
    super(message, 13);
  }
}

/**
 * Thrown when the port allocator cannot find a vacant port block.
 */
export class PortRangeExhaustedError extends WorktideError {
  constructor(message = 'No available port range found in registry.') {
    super(message, 20);
  }
}

/**
 * Thrown when an external process occupies a candidate port range.
 */
export class PortConflictError extends WorktideError {
  constructor(message) {
    super(message, 21);
  }
}

/**
 * Thrown when a process listening on an allocated port refuses termination.
 */
export class ProcessTerminationError extends WorktideError {
  constructor(message) {
    super(message, 30);
  }
}
