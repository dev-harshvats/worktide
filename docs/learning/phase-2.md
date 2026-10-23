# Phase 2: Database Registry & Port Allocator

## What Was Built
- **SQLite Database Connection & Migration Engine (`src/db/connection.js`, `src/db/schema.sql`):**
  - Integrated `better-sqlite3` targeting native local storage at `~/.config/worktide/registry.db` (customizable via `WORKTIDE_HOME`).
  - Enabled Write-Ahead Logging (`PRAGMA journal_mode = WAL`) to support non-blocking concurrent reads and fast transactional writes.
  - Configured `PRAGMA foreign_keys = ON` to enforce relational integrity and cascade deletes across models.
  - Set `PRAGMA busy_timeout = 5000` so competing CLI commands wait for lock release instead of immediately failing with `SQLITE_BUSY`.
  - Automated schema migration on connection initialization:
    - `repos`: Tracks git repository roots (`id`, `repo_path`, `created_at`).
    - `worktrees`: Tracks active worktree paths and branch mappings (`id`, `repo_id`, `branch`, `worktree_path`, `created_at`).
    - `port_allocations`: Tracks allocated port blocks (`id`, `worktree_id`, `port_start`, `port_end`, `allocated_at`).
- **Data Access Queries (`src/db/queries.js`):**
  - Implemented parameterized SQLite queries preventing SQL injection and ensuring clean data lifecycle management:
    - `findOrCreateRepo`: Upserts repo by path.
    - `getWorktreeByBranch`, `getWorktreeByPath`: Lookups for idempotency checks.
    - `createWorktree`: Inserts registered worktree records.
    - `removeWorktree`: Deletes worktree and cascades deletion of port allocations.
    - `getAllAllocatedPorts`: Retrieves sorted port ranges for gap analysis.
    - `listActiveWorktrees`: Multi-table joins returning worktree paths, branches, port ranges, and repo metadata.
- **Port Allocation Service (`src/services/ports.js`):**
  - **Deterministic Lowest-Gap Algorithm:** Scans all active port reservations starting at base port `3000` (block size: 10 ports, e.g., `3000–3009`, `3010–3019`). Finds the lowest released gap before expanding to higher port ranges.
  - **Live OS Socket Probing (`isPortFree`):** Uses Node's `net.createServer` to test bindability on `0.0.0.0` for all 10 ports in a candidate block. If any external daemon (e.g. Docker, Postgres) occupies a port, the block is rejected and the algorithm advances to the next block.
  - **Atomic Transactional Reservation (`allocatePortRange`):** Wraps port discovery and database insertion in a SQLite transaction (`BEGIN IMMEDIATE`) to prevent race conditions during concurrent allocations.
  - **Release Logic (`releasePortRange`):** Deallocates port blocks by worktree ID.
- **Testing (`test/db.test.js`, `test/ports.test.js`):**
  - In-memory database isolation tests verifying schema initialization, cascading foreign keys, and WAL pragma configuration (5 tests).
  - Port service tests verifying gap reuse, multi-port block isolation, and socket probing fallback (6 tests).

---

## Interview Questions & Deep-Dive Explanations

### 1. Why use SQLite with WAL mode (`PRAGMA journal_mode = WAL`) instead of a JSON file or full database server?
- **Why not a JSON file:** Multiple terminals or autonomous AI agents running `worktide start` in parallel will read and write simultaneously. With a JSON file, simultaneous file writes trigger race conditions, file corruption, or lost updates (read-modify-write hazard).
- **Why not Postgres/MySQL/Redis:** A developer CLI tool must be zero-configuration and zero-dependency. Requiring users to spin up a Docker container or background database daemon before running a CLI is a huge adoption barrier.
- **Why SQLite + WAL:**
  - SQLite is embedded directly into the Node process via `better-sqlite3` (synchronous C++ bindings, ~100k queries/sec).
  - Standard SQLite locks the entire database file during writes. In **WAL (Write-Ahead Logging)** mode, writes are appended to a separate `.db-wal` log file.
  - Readers do not block writers, and writers do not block readers. A user running `worktide status` (read) can query instantly without waiting for a concurrent `worktide start` (write transaction) to finish.

### 2. How does the lowest-gap port allocation algorithm work, and why consecutive 10-port blocks?
- **The Problem:** Modern web stacks rarely use a single port. A full-stack application typically spins up a frontend dev server (e.g., Vite on `3000`), a backend API server (e.g., Express on `3001`), a background worker (`3002`), and a mock auth server (`3003`). If a tool assigns only one random port, the developer has to manually configure ports for the other services.
- **The Block Allocation Solution:** WorkTide allocates a contiguous block of 10 ports (`port_start` to `port_end`, such as `3010–3019`).
- **Gap-Reuse Mechanics:**
  - Active blocks are retrieved from SQLite sorted by `port_start`.
  - The algorithm iterates starting from base port `3000` in increments of 10.
  - If worktrees on `3010–3019` and `3030–3039` exist (because `3020–3029` was previously deleted), WorkTide detects the `3020–3029` gap and immediately claims it.
  - This prevents port number inflation (ports creeping into the 40000s) and keeps local environments clean and predictable.

### 3. Why is an in-database port record not enough, and why must you perform a live OS TCP socket probe?
- An in-database registry only knows about ports that *WorkTide itself* allocated.
- It has no visibility into independent services running on the developer's machine—such as a local PostgreSQL server on `5432`, a Docker container mapped to `3010`, or a teammate's script running on `3000`.
- If WorkTide only checked the database, it might allocate `3010–3019` while an external service is already listening on `3010`. When the user runs `npm run dev`, their dev server will crash with `EADDRINUSE`.
- **The Two-Tier Solution:**
  1. Find candidate free block in SQLite.
  2. For every port in `[port_start, port_end]`, attempt to bind a transient TCP server using `net.createServer().listen({ port, host: '0.0.0.0' })`.
  3. If all 10 ports successfully bind and close, the block is truly available. If even one port fails with `EADDRINUSE`, the candidate block is skipped and the search continues.

### 4. How does `PRAGMA busy_timeout = 5000` handle database lock contention?
- When two processes attempt to write to SQLite simultaneously, one acquires the write lock and the second encounters a lock collision.
- By default, SQLite immediately throws an `SQLITE_BUSY` error, crashing the second command.
- Setting `PRAGMA busy_timeout = 5000` configures SQLite's internal engine to sleep and retry exponentially for up to 5000ms before returning an error.
- Since WorkTide's write transactions complete in under 5 milliseconds, a 5000ms busy timeout completely eliminates transient locking errors in parallel agent workflows.
