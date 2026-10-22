# WorkTide — System Design & Technical Interview Guide 🎓

This guide contains deep-dive architectural rationales, tradeoffs, and system design answers for discussing WorkTide in engineering interviews.

---

## 1. Why SQLite with WAL Mode for a Local CLI?

### Question: "Why use SQLite instead of a JSON or YAML config file for tracking local worktrees?"
- **Concurrency & File Locks:** Multiple worktree commands or parallel coding agents can execute at the exact same millisecond. Concurrent writes to a flat JSON file cause race conditions, lost updates, or truncated files.
- **WAL Mode (Write-Ahead Logging):** 
  - Readers never block writers, and writers never block readers (`PRAGMA journal_mode = WAL`).
  - Read queries remain instantaneous even while an active transaction is recording a new worktree.
- **ACID Transactions:** SQLite provides atomic commits (`BEGIN IMMEDIATE`). If an allocation or rollback occurs, either all database records update or none do.
- **Relational Integrity & Foreign Keys:** `PRAGMA foreign_keys = ON` ensures that deleting a repository or worktree record automatically cascade-deletes related port allocations with zero dangling pointers.

---

## 2. Port Allocation: Gap Reuse vs. Random Ports

### Question: "Why allocate deterministic blocks of 10 ports with gap-reuse instead of assigning random free ports?"
- **Microservices & Multi-Port Stacks:** Modern applications rarely use just one port. A Next.js frontend might run on `3000`, a background worker on `3001`, an API server on `3002`, and a mock auth server on `3003`. Giving each worktree 10 consecutive ports (`PORT` to `PORT_END`) allows entire multi-service stacks to boot without port conflicts.
- **Gap-Finding Algorithm:**
  - When worktrees are torn down, their port ranges are released.
  - WorkTide searches for the **lowest available gap** starting at base port `3000`.
  - This keeps port numbers low, predictable, and clean rather than expanding indefinitely towards `65535`.
- **Two-Tier Verification (Database + OS Socket Probe):**
  - Even if the SQLite database thinks port `3010` is available, an external program (e.g. Docker, Postgres) might be using it.
  - WorkTide verifies via `net.createServer` before reserving the block. If any port in the candidate range is busy, it automatically increments to the next block.

---

## 3. Worktree Provisioning & Atomic Reverse Rollback

### Question: "How does WorkTide ensure no corrupted state lingers if a provisioning step fails halfway?"
- Provisioning involves multiple side effects across different subsystems:
  1. SQLite worktree record creation
  2. Port allocation reservation
  3. `git worktree add` filesystem & ref creation
  4. `node_modules` symlink creation
  5. `.env*` file propagation
  6. Managed block injection into `.env.local`
- **Reverse Rollback Stack:**
  - As each step succeeds, its inverse undo operation is pushed onto a rollback stack.
  - If a step throws an error (e.g. disk full, git branch collision, symlink error):
    - The error is caught.
    - All rollback callbacks execute in **reverse order** (undoing step 3 before step 2 before step 1).
    - Cleans up created `.env` files, invokes `git worktree remove --force`, releases the SQLite port allocation, and marks the DB record removed.
    - Re-throws the original error so the user/agent receives the exact failure reason.

---

## 4. Process Supervision & Safe Teardown

### Question: "Why does WorkTide strictly scope process termination to allocated ports?"
- **Preventing Collateral Damage:** Blindly killing Node processes (`pkill node`) would terminate other projects, IDE background servers, or unrelated developer tasks.
- **Strict Port Scoping:**
  - `worktide done` queries `lsof` (or platform equivalent) strictly for ports in `[port_start, port_end]`.
  - Only processes actively listening on those specific allocated ports are targeted.
- **Two-Phase Termination (`SIGTERM` -> `SIGKILL`):**
  - Phase 1 sends `SIGTERM`, allowing servers to close database connections and finish active HTTP requests gracefully.
  - WorkTide polls process liveness for up to 3 seconds.
  - If a process hangs or refuses to exit, Phase 2 escalates to `SIGKILL` to prevent orphaned background zombie processes.

---

## 5. Self-Healing Architecture (`worktide doctor`)

### Question: "How does the system self-heal when external tools alter git state or the filesystem?"
- Developers and scripts often delete folders (`rm -rf`) or manually run `git worktree remove` without notifying WorkTide.
- **Three-Way Discrepancy Detection:**
  1. **Filesystem vs Registry:** Detects active DB records whose folders no longer exist on disk.
  2. **Git vs Registry:** Compares SQLite entries against `git worktree list --porcelain`.
  3. **Symlink Integrity:** Identifies broken `node_modules` symlinks pointing to moved or deleted checkouts.
  4. **Lock Contention:** Flags `.git/index.lock` files older than 60 seconds (abandoned by crashed Git commands).
- Running `worktide doctor --fix` automatically cleans stale locks, prunes orphaned DB records, frees orphaned port blocks, and repairs symlinks.
