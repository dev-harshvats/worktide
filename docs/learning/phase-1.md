# Phase 1: Project Skeleton & Architecture Foundations

## What Was Built
- **Project Configuration (`package.json`, `.gitignore`, `LICENSE`):**
  - Configured native ES Modules (`"type": "module"`) targeting Node.js `>=18.0.0` with zero build steps.
  - Declared binary executable entrypoint (`"bin": { "worktide": "./bin/worktide.js" }`).
  - Added MIT License under Harsh Vats.
  - Configured comprehensive `.gitignore` explicitly excluding `node_modules`, test artifacts, databases, and AI-tool metadata/sessions (`.claude/`, `.cursor/`, `.gemini/`, `AGENTS.md`, etc.).
- **Domain Error Hierarchy (`src/utils/errors.js`):**
  - Created base `WorktideError` and semantic subclasses (`UsageError`, `GitError`, `WorktreeExistsError`, `WorktreeNotFoundError`, `DirtyWorktreeError`, `PortRangeExhaustedError`, `PortConflictError`, `ProcessTerminationError`).
  - Assigned distinct, semantic exit codes (e.g. 2 for syntax/usage, 10 for git failures, 20 for port exhaustion) adhering to POSIX conventions.
- **Stream-Separated Logger (`src/utils/logger.js`):**
  - Strict separation of streams: stdout for normal status and data, stderr for warnings and errors.
- **CLI Skeleton (`src/cli.js`, `bin/worktide.js`):**
  - Built Commander setup with `-v, --version`, `-h, --help`, and all four commands stubbed (`start <branch>`, `status`, `done <branch>`, `doctor`).
  - Wired central error boundary in `src/cli.js` to catch errors and set `process.exitCode` deterministically.
- **Test Infrastructure (`vitest.config.js`, `test/`):**
  - Vitest configured for Node environment.
  - 3 test suites passing (7 tests total) covering error exit codes, logger stream routing, and CLI option registrations.

---

## Interview Questions & Deep-Dive Explanations

### 1. Why use native ES Modules (ESM) instead of CommonJS or TypeScript compilation?
- **Fast Startup Time:** CLI utilities are frequently spawned by users and background tools (like AI agents). Transpilation steps (like `tsc` or `tsx` at runtime) add noticeable cold-start latency. Native ESM with Node 18+ runs immediately with no build pipeline.
- **Zero Build Artifact Drift:** Without a `dist/` or `build/` folder, the source code is the runtime code. You never debug a production issue caused by a stale build cache or out-of-sync source maps.
- **Modern Ecosystem Alignment:** Top Node CLI libraries (such as `execa` v9) are ESM-only packages.

### 2. Why are explicit exit codes critical for a CLI tool?
- In Unix environments, when another script or agent executes `worktide`, the return code (`$?`) is the machine contract:
  - Exit code `0`: Success.
  - Exit code `2`: Invalid command-line usage or arguments (`UsageError`). The caller should not retry without correcting inputs.
  - Exit code `10`: Git operation failure (e.g., branch collision, not a git repo).
  - Exit code `13`: Dirty working tree preventing teardown.
  - Exit code `20`: Port exhaustion. The caller knows to clean up old worktrees rather than suspecting a syntax error.
- Without semantic exit codes, automated orchestrators are forced to scrape human-readable stderr strings to understand failures, which is brittle and error-prone.

### 3. Why must CLI tools strictly separate stdout and stderr?
- Standard output (`stdout`, file descriptor 1) is reserved for program output and data pipelines (e.g., `worktide status --json | jq .`).
- Standard error (`stderr`, file descriptor 2) is reserved for diagnostics, warnings, and error messages.
- If a logging statement (`logger.info("Connecting to database...")`) is accidentally sent to `stdout`, piping JSON output into another utility will cause JSON parsing crashes.

### 4. How does `npm link` and the shebang line work?
- The first line `#!/usr/bin/env node` (the "shebang") tells Unix-based operating systems which binary should interpret the file when executed directly (`./bin/worktide.js`).
- Running `npm link` reads the `"bin"` field in `package.json` and creates a symlink in the system's global npm prefix directory (e.g. `/usr/local/bin/worktide` or `~/.nvm/.../bin/worktide`) pointing directly to `bin/worktide.js`.
- This makes the `worktide` command globally accessible anywhere on the system during local development.
