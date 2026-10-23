# Phase 4: Status Inspection & Process Supervision (`worktide status` & `worktide done`)

## What Was Built
- **Port-Scoped Process Supervision (`src/services/procs.js`):**
  - **Process Discovery by Port:** Discovers PIDs actively listening on TCP ports within a specified range (`[port_start, port_end]`):
    - Uses `lsof -ti :<port> -sTCP:LISTEN` on macOS/Linux.
    - Uses `netstat -ano -p tcp` parsed regex on Windows to accurately extract listening PIDs.
  - **Process Liveness Probing (`isWorktreeLive`):**
    - Checks whether any port in the worktree's allocated block is currently occupied by a listening process.
    - Returns `'live'` if servers are active, or `'down'` if idle.
  - **Two-Phase Termination Engine (`terminateProcessesOnPorts`):**
    - **Phase 1 (Graceful Shutdown):** Dispatches `SIGTERM` to discovered PIDs, giving dev servers and database connections an opportunity to flush write buffers and close sockets gracefully.
    - **Liveness Polling:** Actively polls process survival every 200ms for up to 3000ms.
    - **Phase 2 (Forced Termination):** If any process refuses to shut down or hangs after 3 seconds, WorkTide escalates to `SIGKILL` (or `taskkill /F /PID` on Windows) to eliminate orphaned zombie processes.
- **Worktree Status Reporter (`src/commands/status.js`):**
  - Joins repositories, worktree records, and port allocations from SQLite.
  - Filters by current repository root by default, or shows all system-wide worktrees if `-a, --all` is provided.
  - Renders a clean terminal table with fixed-width column alignment:
    ```text
    BRANCH         PORTS       STATUS   PATH
    ------------   ---------   ------   ------------------------
    feature/auth   3010-3019   live     /dev/myrepo-feature-auth
    feature/ui     3020-3029   down     /dev/myrepo-feature-ui
    ```
  - **Machine-Readable JSON Mode (`--json`):** Emits pure, parseable JSON arrays directly to `stdout` for programmatic piping into AI agents, scripts, or dashboards (`worktide status --json | jq .`).
- **Safe Worktree Teardown (`src/commands/done.js`):**
  - Resolves target branch in registry; raises semantic `WorktreeNotFoundError` (exit code 12) if branch is unknown.
  - **Dirty State Guard:** Runs `git.isDirty` inside the worktree directory. If uncommitted edits, staged changes, or untracked files are detected, operation aborts with `DirtyWorktreeError` (exit code 13) to protect the developer from accidental data loss.
  - **Force Flag (`-f, --force`):** Allows callers or AI agents to explicitly bypass dirty checks when intentional abandonment of scratch work is desired.
  - **Full Resource Teardown:**
    1. Kills all listening background processes on the allocated port block.
    2. Runs `git worktree remove --force` and unlinks filesystem directory.
    3. Runs `git worktree prune` to clean internal git metadata.
    4. Deletes the SQLite record, which cascades and immediately frees the port range for future worktrees.
- **Testing (`test/status.test.js`, `test/done.test.js`, `test/procs.test.js`):**
  - 9 automated test suites verifying dirty state protection, force teardown, process supervision, table rendering, and JSON output formatting.

---

## Interview Questions & Deep-Dive Explanations

### 1. Why is process termination strictly scoped by TCP port ranges rather than process names like `pkill node`?
- **The Catastrophic Collateral Damage Problem:** In modern multi-project development, developers typically have multiple Node.js processes running simultaneously:
  - Language servers and syntax linters inside VS Code / Cursor
  - Build watchers on other branches or other repositories
  - Global dev tools and background daemons
- If a teardown command executes `pkill node` or searches by process name, it indiscriminately kills all other worktrees, IDE extensions, and unrelated projects.
- **The Port-Scoped Solution:**
  - WorkTide knows the exact port range assigned to the worktree (`[port_start, port_end]`).
  - It queries the OS kernel strictly for socket bindings on those specific port numbers.
  - Only processes actively bound to those ports are killed. Other projects and editor processes remain completely untouched.

### 2. How does the two-phase termination sequence (`SIGTERM` $\rightarrow$ poll $\rightarrow$ `SIGKILL`) work, and why is immediate `SIGKILL` dangerous?
- `SIGKILL` (signal 9) cannot be caught, blocked, or handled by a process. The OS kernel terminates the process immediately.
- **Why immediate `SIGKILL` is dangerous:**
  - Database connections (SQLite, PostgreSQL, Redis) cannot send termination packets, causing connection pool exhaustion on servers.
  - In-flight HTTP requests and file write buffers are terminated mid-write, leading to corrupted lockfiles or half-written temporary files.
- **The Two-Phase Protocol:**
  1. WorkTide sends `SIGTERM` (signal 15). Node's `process.on('SIGTERM')` listeners fire, allowing Express/Fastify/Vite servers to close listening sockets and finish database transactions.
  2. WorkTide polls the process table every 200ms. If the process exits within 3 seconds, shutdown is clean.
  3. If a process enters an infinite loop or deadlocks and remains alive after 3000ms, WorkTide issues `SIGKILL` as a last resort to guarantee no zombie processes linger on the ports.

### 3. Why check `git status --porcelain` before tearing down a worktree?
- When deleting a worktree via `git worktree remove`, Git deletes the directory from the filesystem.
- If a developer or AI coding agent wrote code in that worktree but forgot to commit or push it, tearing down the worktree will permanently delete those files without any reflog or undo history.
- WorkTide runs `git status --porcelain`:
  - If output is non-empty (modified files, staged changes, or untracked scratch files), it throws `DirtyWorktreeError` and halts before touching the filesystem.
  - Requiring an explicit `--force` flag ensures that data is only destroyed when the human or agent explicitly commands it.

### 4. What is the difference between human CLI output and machine `--json` output?
- Human-facing output uses ASCII tables, terminal colors, headers, and spacing for visual clarity.
- Parsing human-readable tables with tools like `awk` or regex is fragile (e.g. branch names with spaces or long paths break column alignment).
- By providing `--json`, WorkTide provides a stable machine API contract:
  - Output is printed strictly to `stdout` with no extraneous log text.
  - External orchestrators (CI/CD pipelines, tmux scripts, Raycast extensions, AI agents) can pipe the output into `jq` or parse it directly in JSON without brittle text scraping.
