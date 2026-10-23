# Phase 5: Self-Healing Health Diagnostics (`worktide doctor`)

## What Was Built
- **Diagnostic Engine (`src/services/doctor.js`):**
  - **Three-Way Discrepancy Detection:** Reconciles inconsistencies across three independent sources of truth: the local filesystem, Git internal refs, and the SQLite registry database:
    1. **Orphaned Registry Records:** Detects database worktree records whose target directories no longer exist on disk (e.g., if a developer manually deleted the folder via `rm -rf` or file explorer).
    2. **Broken Dependency Links:** Scans active worktrees for broken or missing `node_modules` symlinks/junctions (e.g., if root `node_modules` was reinstalled or moved).
    3. **Stale Git Locks:** Traverses `.git/index.lock` and `.git/worktrees/*/locked` files. Computes file age against a 60-second threshold to distinguish between active Git operations and stale locks left behind by crashed processes.
  - **Inspection Routine (`runDiagnostics`):**
    - Non-destructive audit that returns an array of structured issue objects:
      ```javascript
      {
        type: 'orphaned_db_record' | 'broken_symlink' | 'stale_git_lock',
        description: string,
        repairable: boolean,
        metadata: object
      }
      ```
  - **Automated Self-Healing (`repairIssues`):**
    - **Orphan Cleanup:** Removes dangling SQLite worktree rows and automatically deallocates their reserved port ranges so the ports can be reused.
    - **Symlink Reconstruction:** Recreates directory junctions/symlinks pointing back to the root `node_modules`.
    - **Lock File Pruning:** Safely unlinks abandoned `.git/index.lock` files, unblocking Git operations without requiring manual terminal surgery.
- **CLI Interface (`src/commands/doctor.js`):**
  - Default mode (`worktide doctor`): Performs a non-mutating health inspection, printing formatted status reports, issue counts, and actionable advice.
  - Fix mode (`worktide doctor --fix`): Executes repair routines for all detected anomalies, logging each remediation in real time with green success confirmations.
- **Testing (`test/doctor.test.js`):**
  - 3 comprehensive integration tests validating zero false-positives on healthy repos, multi-anomaly detection, orphaned record deletion, and stale lock removal.

---

## Interview Questions & Deep-Dive Explanations

### 1. Why is an explicit `doctor` command essential for tools that manage state across external systems?
- **The "Drift" Problem:** In a perfect world, all changes happen through the CLI. In the real world, developers and third-party tools interact with the environment independently:
  - A developer runs `rm -rf ../repo-feature-branch` instead of `worktide done`.
  - An IDE crashes while Git is writing an index lock.
  - A developer deletes `node_modules` in the root repository and runs a fresh `npm install`.
- When external actions occur, the tool's internal database drifts out of sync with physical reality.
- Rather than crashing mysteriously during normal operations, a production-grade developer tool provides a `doctor` command to inspect, diagnose, and repair drift safely.

### 2. What causes `.git/index.lock` files, why is blindly deleting them dangerous, and how does WorkTide determine if a lock is truly stale?
- **Why Git Uses Lock Files:** Git operations (like `git add` or `git commit`) write an atomic lock file `.git/index.lock` to prevent two concurrent Git processes from corrupting the index simultaneously. Once the operation finishes, Git renames the file or deletes it.
- **Why Blind Deletion Is Dangerous:** If a user runs a legitimate, long-running Git command (like `git gc` or a huge merge) and another tool immediately deletes `.git/index.lock`, Git's index will suffer irrecoverable binary corruption.
- **The WorkTide Heuristic:**
  - WorkTide inspects the lock file's last modified timestamp (`fs.statSync(lockPath).mtimeMs`).
  - Standard Git operations hold locks for tens or hundreds of milliseconds.
  - WorkTide requires a minimum threshold of **60 seconds**.
  - A lock file older than 60 seconds indicates the process was killed, terminated via `SIGKILL`, or crashed due to an OS reboot. Only then is it safe to clean.

### 3. How does `doctor --fix` reconcile orphaned SQLite records and reclaim reserved ports?
- If a worktree directory is deleted from disk without running `worktide done`:
  - The SQLite database still marks ports `3010–3019` as allocated.
  - Future branches cannot use those ports, causing artificial port exhaustion.
- When `worktide doctor --fix` runs:
  - It iterates through all registered worktree records.
  - Calls `fs.existsSync(record.worktree_path)`.
  - If the directory does not exist, it executes a database transaction:
    1. Releases the port allocation associated with the worktree ID.
    2. Deletes the worktree record from the SQLite table.
  - The ports immediately return to the free port pool and are reusable on the next `worktide start`.
