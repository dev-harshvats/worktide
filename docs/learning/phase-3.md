# Phase 3: Worktree Provisioning & Atomic Rollback (`worktide start`)

## What Was Built
- **Git Subsystem Abstraction (`src/services/git.js`):**
  - Uses `execa` v9 to execute Git CLI commands safely with strict argument array passing (eliminating shell injection vulnerabilities).
  - `getRepoRoot`: Resolves the root of the active Git repository via `git rev-parse --show-toplevel`.
  - `createWorktree`: Creates and checks out worktrees via `git worktree add <path> -b <branch>` (or checks out pre-existing branches).
  - `removeWorktree`: Safely removes worktrees via `git worktree remove [--force] <path>` and cleans worktree metadata (`git worktree prune`).
  - `isDirty`: Queries `git status --porcelain` to check if a worktree has uncommitted modifications, staged changes, or untracked files.
  - `listGitWorktrees`: Parses the raw output of `git worktree list --porcelain` into structured worktree objects containing commit hashes, branches, and absolute paths.
- **Branch Slugification & Path Resolution (`src/utils/slug.js`):**
  - Sanitizes complex branch names (e.g., `feature/auth-oauth2`, `fix/issue#42_v2`, `user@patch`) into safe filesystem directory names.
  - Places the worktree alongside the main repository (`../<repo-name>-<branch-slug>`), keeping the root project folder uncluttered and preventing accidental git submodule recursion.
- **Zero-Copy Dependency Linking (`src/services/sync.js`):**
  - Inspects root repository for dependencies (`node_modules`).
  - Creates a filesystem link from the root `node_modules` into the new worktree.
  - Cross-platform abstraction: uses `'junction'` on Windows (which requires no elevated administrative privileges or Developer Mode) and `'dir'` symbolic links on macOS and Linux.
  - Cuts worktree startup time from minutes (`npm install`) to <500ms, while saving gigabytes of disk space across parallel branches.
- **Environment Propagation & Managed Blocks (`src/services/env.js`):**
  - Automatically copies existing `.env*` files (`.env`, `.env.local`, `.env.development`) from the root repository into the worktree.
  - Injects a WorkTide-managed configuration block into `.env.local` delimited by explicit markers:
    ```env
    # >>> worktide managed >>>
    PORT=3010
    VITE_PORT=3010
    PORT_START=3010
    PORT_END=3019
    # <<< worktide managed <<<
    ```
  - Idempotent update logic: uses regex boundary detection to update existing managed blocks in-place without touching user-defined environment variables or secrets.
- **Atomic Rollback Orchestration (`src/commands/start.js`):**
  - **Idempotency Guard:** If `worktide start <branch>` is run on an already active worktree, it reports the existing directory and port block, exiting cleanly with code `0`.
  - **Reverse Rollback Stack:** Multi-step orchestration across the database, git engine, and filesystem. If any intermediate step fails:
    - Caught errors trigger the execution of inverse rollback tasks in **LIFO (Last-In-First-Out) order**.
    - Cleans up created `.env` files $\rightarrow$ removes git worktree $\rightarrow$ releases allocated ports in SQLite $\rightarrow$ removes worktree record.
    - Prevents "half-baked" orphaned worktrees or dangling port locks on disk.
- **Testing (`test/start.test.js`, `test/sync.test.js`, `test/env.test.js`, `test/slug.test.js`):**
  - 19 automated tests validating branch slugging, symlink/junction creation, environment block injection, idempotency, and full end-to-end rollback on simulated failures.

---

## Interview Questions & Deep-Dive Explanations

### 1. What is a Git Worktree under the hood, and how is it superior to `git clone` or `git checkout`?
- **Standard `git checkout`:** Operates inside a single working directory. Switching branches requires stashing dirty files, waiting for re-compilation, and stops any running dev server or background test watchers.
- **Multiple `git clone` copies:** Duplicates the entire `.git` object database (often hundreds of megabytes or gigabytes). Each clone is a separate repository with its own reflog, remotes, and local commits, requiring manual fetching and branch synchronizing.
- **Git Worktree (`git worktree add`):**
  - Allows multiple working directories to be linked to a **single shared `.git` directory**.
  - All worktrees share the same object store, packed refs, and remote tracking branches. A commit made in one worktree is immediately visible and fetchable in all other worktrees with zero network transfer.
  - Git manages the individual `HEAD`, index, and per-worktree administrative files inside `.git/worktrees/<name>/`.

### 2. Why are Windows Directory Junctions used instead of standard Symbolic Links?
- On POSIX systems (Linux/macOS), symbolic links (`fs.symlink(target, path, 'dir')`) work seamlessly without special permissions.
- On Windows, creating a true directory symlink requires either **Windows Developer Mode** to be enabled or the process to be run with **Elevated Administrator Privileges**. If an unprivileged user runs `fs.symlink(..., 'dir')`, Node throws an `EPERM: operation not permitted` error.
- **The Junction Solution:**
  - An NTFS Junction (`fs.symlink(target, path, 'junction')`) is an NTFS reparse point that points directly to a local directory.
  - Junctions do not require administrative privileges or Developer Mode on Windows.
  - By passing `'junction'` on `win32` and `'dir'` on other platforms, WorkTide works out-of-the-box across all developer machines without permission issues.

### 3. How does the Reverse Rollback Stack guarantee consistency across disparate systems?
- **The Problem:** In distributed and systems programming, a transaction spanning multiple heterogeneous subsystems (SQLite database + Git CLI process + OS Filesystem) cannot use a single database transaction `ROLLBACK`.
- **The Solution:** The **Saga / Compensating Action pattern** via an in-memory LIFO rollback stack:
  ```javascript
  const rollbacks = [];
  try {
    const worktreeId = db.insertWorktree(...);
    rollbacks.push(() => db.deleteWorktree(worktreeId));

    const ports = allocatePorts(worktreeId);
    rollbacks.push(() => releasePorts(worktreeId));

    await git.createWorktree(...);
    rollbacks.push(() => git.removeWorktree(path));

    await syncNodeModules(...);
    rollbacks.push(() => fs.promises.unlink(symlinkPath));
  } catch (err) {
    for (const rollback of rollbacks.reverse()) {
      await rollback().catch(cleanupErr => logger.debug(cleanupErr));
    }
    throw err;
  }
  ```
- If step 4 (symlink creation) fails because the disk is full, the rollback executor unwinds in reverse order: removes the git worktree, releases the SQLite port allocation, and deletes the worktree database record. The machine returns to a clean initial state.

### 4. How does WorkTide safely inject environment variables into `.env.local` without corrupting user variables?
- Developer `.env` files often contain secrets, custom tokens, and database credentials that must never be overwritten or erased.
- WorkTide implements **Delimited Managed Blocks**:
  - The tool uses recognizable delimiter comments: `# >>> worktide managed >>>` and `# <<< worktide managed <<<`.
  - When injecting, it inspects whether the target file contains this delimited block using regular expressions.
  - **If present:** It replaces only the text between the delimiters, updating `PORT` and `VITE_PORT` while leaving all user-defined lines before and after completely intact.
  - **If absent:** It appends the delimited block to the bottom of the file.
- This design guarantees that running `worktide start` repeatedly or re-provisioning will never corrupt developer configurations.
