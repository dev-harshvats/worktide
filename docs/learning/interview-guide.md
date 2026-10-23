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

---

## 6. Cross-Platform Filesystem Linkage: Windows Junctions vs. POSIX Symlinks

### Question: "Why does standard symlinking fail on Windows without elevated administrator rights, and how did you engineer cross-platform dependency sharing?"
- **The Problem on Windows:**
  - On POSIX (Linux/macOS), creating directory symbolic links (`fs.symlink(target, path, 'dir')`) is an unprivileged operation.
  - On Windows, standard directory symlinks require either **Windows Developer Mode** enabled in OS settings or an **Elevated Administrator PowerShell** session. Running unprivileged symlink commands throws `EPERM: operation not permitted`.
- **The NTFS Junction Solution:**
  - WorkTide dynamically selects the link type based on the operating system:
    ```javascript
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.promises.symlink(targetPath, linkPath, type);
    ```
  - An NTFS Junction is a filesystem reparse point pointing directly to a local folder directory.
  - Junctions require **zero administrative privileges** and zero configuration on Windows machines.
  - Junction resolution happens directly inside the NTFS filesystem driver, offering native folder performance with zero disk duplication and instant creation (<5ms).

---

## 7. Concurrency & Race Conditions in Autonomous Agent Workflows

### Question: "If two autonomous AI coding agents run `worktide start` simultaneously on different branches, how does the system prevent port collisions and database locking errors?"
- **The Problem:** In agentic workflows, multiple autonomous agents (e.g., Claude Code, Cursor, Auto-GPT) may trigger worktree provisioning at the exact same millisecond. Without synchronization:
  - Both agents could read the same available port block (e.g. `3010–3019`) and assign it to different branches, causing server startup crashes (`EADDRINUSE`).
  - Concurrent writes to the SQLite database would trigger `SQLITE_BUSY` exceptions.
- **The Solution:**
  1. **SQLite WAL Mode (`PRAGMA journal_mode = WAL`):** Enables non-blocking concurrent reads while write transactions are prepared.
  2. **Exponential Busy Timeout (`PRAGMA busy_timeout = 5000`):** Instead of immediately crashing with `SQLITE_BUSY`, colliding write queries wait and retry exponentially for up to 5 seconds.
  3. **Immediate Write Transactions (`BEGIN IMMEDIATE`):** The port allocation logic acquires the write reservation lock immediately at the start of the transaction, ensuring another process cannot read a stale gap calculation.
  4. **Pre-Commit Socket Probing:** Candidate ports are actively probed with transient `net.createServer` TCP socket binds before the transaction commits.
  - **Empirical Validation:** Hardened with automated concurrency stress tests (`test/concurrency.test.js`) where 10 concurrent asynchronous workers allocate ranges simultaneously with 0 collisions and 0 lock failures.

---

## 8. Safe Environment Variable Injection via Delimited Blocks

### Question: "How does WorkTide safely inject dynamic port configurations into existing `.env` files without overwriting user secrets or corrupting formatting?"
- **The Problem:** Worktrees must inject `PORT=3010` and `VITE_PORT=3010` so dev servers bind to their isolated port automatically. However, user `.env` files contain critical secrets (API keys, database URLs, auth tokens) that must never be destroyed or reformatted.
- **The Solution: Delimited Managed Blocks:**
  - WorkTide injects configuration encapsulated between explicit comment boundaries:
    ```env
    # >>> worktide managed >>>
    PORT=3010
    VITE_PORT=3010
    PORT_START=3010
    PORT_END=3019
    # <<< worktide managed <<<
    ```
  - **Regex Boundary Parser:**
    - Before writing, WorkTide searches for `# >>> worktide managed >>>[\s\S]*?# <<< worktide managed <<<`.
    - If the block exists, WorkTide replaces **only** the contents between the delimiters using clean string substitution.
    - If the block does not exist, it appends the block to the end of the file.
  - **Zero Corruption Guarantee:** All user-defined keys, custom comments, and whitespace outside the delimiters are left 100% untouched.

---

## 9. Release Engineering, Security & Package Bloat Prevention

### Question: "How do you design an npm package distribution pipeline to protect against supply chain vulnerabilities and bloated bundle sizes?"
- **The Problem:** Many npm packages accidentally distribute hundreds of megabytes of test files, CI scripts, documentation, and local development configurations, slowing installation times and potentially leaking internal test credentials.
- **The Engineering Solution:**
  1. **Strict `files` Allowlist in `package.json`:**
     - Rather than relying on `.npmignore` (which is opt-out and prone to omissions), WorkTide uses an explicit opt-in allowlist:
       ```json
       "files": [
         "bin/",
         "src/",
         "README.md",
         "LICENSE",
         "CHANGELOG.md"
       ]
       ```
     - Results in a package size of just **18.3 kB** (unpacked 62.6 kB across 22 files).
  2. **Automated Quality Gate (`prepublishOnly`):**
     - Configured `"prepublishOnly": "npm test"`.
     - When `npm publish` is invoked, Vitest executes all 55 tests across 15 suites. If any test fails, the publish is immediately blocked by npm.
  3. **Minimal Runtime Dependency Tree:**
     - Only 3 runtime dependencies (`better-sqlite3`, `commander`, `execa`). Zero bloated sub-dependencies or unnecessary frameworks.

---

## 10. Architecture Tradeoffs: Git Worktrees vs Containers (Docker / Devcontainers)

### Question: "When would an engineering team choose Git Worktrees over Docker containers or Devcontainers, and what are the system-level tradeoffs?"
- **The Comparison:**
  - **Docker / Devcontainers:** Provide full operating system virtualization, isolated network bridges, isolated filesystem mounts, and OS package management (apt/apk).
  - **Git Worktrees (WorkTide):** Provide isolated Git branch working trees, isolated port blocks, and isolated environment configurations directly on the host OS.
- **Tradeoffs:**
  | Dimension | Docker / Devcontainers | Git Worktrees (WorkTide) |
  | :--- | :--- | :--- |
  | **Spin-Up Latency** | 30s to 5+ minutes (image build / pull / container start) | **< 500 milliseconds** (instant checkout + directory link) |
  | **Disk Usage** | 2GB to 10GB+ per container image layer | **Zero duplication** (`node_modules` linked, shared `.git`) |
  | **CPU & Memory Overhead** | High (Docker Desktop VM on Mac/Win, background dockerd) | **Zero** (runs native host binaries directly) |
  | **IDE & Tooling Integration** | Requires remote SSH/Devcontainer extension bridge | **Native** (open folder in VS Code/Cursor directly, instant LSP) |
  | **Isolation Boundary** | Full kernel & filesystem isolation | Working directory, ports, and environment isolation |
- **When to Choose WorkTide:** For full-stack application development, rapid branch switching, microservice local development, and parallel AI coding agents where instant iteration speed, low resource consumption, and direct host toolchain integration are critical.

