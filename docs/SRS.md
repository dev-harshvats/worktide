# WorkTide — Software Requirements Specification (SRS)

**Document Version:** 1.0.0  
**Author:** Harsh Vats  
**Status:** Approved for Implementation (Phase 0)  

---

## 1. Purpose and Overview

**WorkTide** is a Node.js CLI tool designed to make git worktrees immediately runnable and isolated from one another. 

When developers or AI coding agents (such as Claude Code or Cursor) spin up git worktrees for parallel branch development, fresh worktrees are inert: they lack dependencies (`node_modules`), environment configuration files (`.env`), have conflicting default dev-server ports, and share state unsafely. 

WorkTide solves this problem by:
1. Creating git worktrees and automatically provisioning dependencies (via symlinking) and environment files.
2. Allocating an isolated, conflict-free 10-port range from a centralized local registry.
3. Injecting a managed configuration block into `.env.local` containing `PORT` and `PORT_END`.
4. Gracefully tearing down worktrees, freeing allocated ports, and killing lingering processes tied to allocated ports.
5. Providing health checks and automated repairs for orphaned or inconsistent states.

---

## 2. Functional Requirements

### FR-1: Worktree Provisioning (`worktide start <branch>`)
- The CLI shall create a git worktree for `<branch>` and fully provision it with linked dependencies, copied environment variables, and an allocated port block.
- If the branch does not exist locally, the CLI shall create the branch based on the current HEAD or remote tracking branch.
- If the branch is already checked out or the worktree exists, the command shall exit cleanly without breaking state (idempotent).

### FR-2: Dependency Linking
- The CLI shall detect if `node_modules` exists in the primary checkout (repo root).
- If present, the CLI shall create a directory symlink (`node_modules`) inside the worktree pointing to the root `node_modules`.
- If `node_modules` is absent, the CLI shall skip linking gracefully without error.

### FR-3: Environment File Propagation
- The CLI shall copy `.env` and all `.env.*` files (e.g., `.env.development`, `.env.test`) from the repo root into the root of the new worktree.
- Existing user values in the copied environment files must be preserved.

### FR-4: Port Allocation
- The CLI shall allocate a unique range of 10 consecutive ports per worktree (e.g., 3000–3009, 3010–3019).
- Allocation must be globally collision-free across all git repositories registered on the local machine.
- Port allocation shall start at base port `3000`.
- Released port ranges must be reused (lowest available gap first).

### FR-5: Managed Environment Block
- The CLI shall write `PORT=<port_start>` and `PORT_END=<port_end>` into `.env.local` in the worktree.
- The values must be wrapped in deterministic markers:
  ```env
  # >>> worktide managed >>>
  PORT=3010
  PORT_END=3019
  # <<< worktide managed <<<
  ```
- Any existing content or custom user variables in `.env.local` outside the markers must be strictly preserved.

### FR-6: Worktree Status (`worktide status`)
- The CLI shall report all registered worktrees, displaying:
  - Branch name
  - Slug / relative path
  - Allocated port range
  - Process liveness status (`live` if any process is listening on the primary port; `down` otherwise)
- The command shall support a `--json` flag for machine-readable output.

### FR-7: Worktree Teardown (`worktide done <branch>`)
- The CLI shall tear down the specified worktree and release its port allocation.
- The command must inspect only the allocated port range and terminate active listening processes (`SIGTERM` followed by `SIGKILL` after 3 seconds if still responsive).
- The command must inspect git status and refuse teardown if the worktree contains uncommitted or untracked changes, unless the `--force` flag is supplied.
- Upon successful teardown, the git worktree must be removed from disk and git pruned, and the registry status updated to `removed`.

### FR-8: System Integrity and Health (`worktide doctor`)
- The CLI shall detect and report anomalies between the filesystem, git state, and the SQLite registry:
  - Broken `node_modules` symlinks
  - Orphaned registry allocations (worktree record exists in DB, but path does not exist on disk or in git)
  - Stale `.git/index.lock` files
- When invoked with `--fix`, the CLI shall automatically repair detected inconsistencies.

### FR-9: Idempotency
- Running any command repeatedly (`start`, `done`, `doctor`) with the same inputs must never corrupt internal state, duplicate records, or produce confusing errors.

---

## 3. Non-Functional Requirements

### NFR-1: Concurrency and State Integrity
- All registry reads and writes affecting allocations and worktree lifecycles must run inside SQLite transactions (`BEGIN IMMEDIATE` / `WAL` mode).
- Concurrent CLI runs on the same machine must never hand out identical ports or corrupt the SQLite database.

### NFR-2: Process Isolation and Safety
- Teardown operations must NEVER terminate, signal, or inspect processes or ports not explicitly allocated to the target worktree.

### NFR-3: CLI Output and Exit Codes
- Normal output and machine-readable data must be emitted to `stdout`.
- Diagnostic messages, errors, and warnings must be emitted to `stderr`.
- Successful commands must exit with code `0`.
- Errors must terminate with specific non-zero exit codes (e.g., user error vs. runtime failure) with actionable error descriptions.

### NFR-4: Atomic Rollback on Failure
- If `worktide start` fails at any intermediate step (port probe, git worktree creation, symlink, or file writing), a complete rollback must be triggered.
- Rollback must undo all side effects in reverse creation order:
  1. Remove written environment files (`.env.local`, copied `.env*`).
  2. Remove created worktree directory and invoke `git worktree remove --force`.
  3. Release SQLite port allocation and remove DB record.
- No partial or orphaned state may linger after a failed start.

---

## 4. Scope and Limitations

### Out of Scope for Version 1
- **Operating Systems:** Microsoft Windows is out of scope. (WorkTide targets macOS and Linux only).
- **Non-Node Stacks:** Automatic dependency linking for Python (`venv`), Go, Rust, or other runtimes is excluded.
- **Docker / Containers:** Containerized worktree isolation or port forwarding.
- **Database Cloning:** Local database branching or seeding (e.g., Postgres / MySQL schemas).
- **Shell Completions:** Shell autocomplete scripts (bash/zsh).
- **Package Installation:** Running `npm install`, `pnpm install`, or `yarn` automatically. Only symlinking existing `node_modules` is supported.
