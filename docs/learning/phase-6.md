# Phase 6: Hardening, Concurrency Stress & Release Engineering

## What Was Built
- **Concurrency & Race Condition Hardening (`test/concurrency.test.js`):**
  - **Parallel Allocation Stress Test:** Spawns 10 asynchronous concurrent workers simultaneously competing to allocate port blocks against the SQLite registry.
  - **Zero-Collision Invariant:** Proves that all allocated port ranges (`[port_start, port_end]`) are mutually exclusive and strictly non-overlapping.
  - **Lock Contention Verification:** Proves that SQLite WAL mode combined with `PRAGMA busy_timeout = 5000` gracefully queues competing transactions without throwing `SQLITE_BUSY` errors.
- **Edge-Case & Anomaly Recovery (`test/edge-cases.test.js`):**
  - **Corrupted Environment Recovery:** Verifies that if a user manually breaks or corrupts the managed `# >>> worktide managed >>>` block in `.env.local`, WorkTide repairs the boundary delimiters without losing existing user-defined environment variables.
  - **Compound Anomaly Healing:** Validates that `worktide doctor --fix` can simultaneously detect and heal multiple anomalies (e.g., orphaned registry records + stale git locks) in a single repair pass.
  - **Pathological Branch Slugs:** Validates slugification against extreme branch names with deep slashes (`feature/deeply/nested/auth/v2.1`), uppercase strings, and non-alphanumeric symbols.
- **Production Packaging & Release Engineering:**
  - **Strict `files` Allowlist (`package.json`):**
    - Configured explicit package inclusion allowlist: `bin/`, `src/`, `README.md`, `LICENSE`, `CHANGELOG.md`.
    - Excludes test files, documentation, benchmarks, AI metadata (`.claude/`, `.gemini/`), and graphic assets from the published package.
    - Keeps the final npm tarball at an ultra-lightweight **18.3 kB** (unpacked 62.6 kB, 22 total files).
  - **Pre-Publish Quality Gate (`prepublishOnly`):**
    - Configured `"prepublishOnly": "npm test"`, guaranteeing that `vitest run` executes all 55 tests across 15 suites before `npm publish` can upload artifacts to the registry.
  - **Cross-Version Matrix CI/CD (`.github/workflows/ci.yml`):**
    - Built GitHub Actions workflow testing matrix across Node.js versions `18.x`, `20.x`, and `22.x`.
    - Enforces linting, security audits, and full test suite execution on every pull request and push to `main`.
- **Comprehensive Documentation Suite:**
  - Redesigned visual README with custom architectural banner, live status demo, and workflow charts.
  - Created [System Requirements Specification](../SRS.md), [System Design Document](../DESIGN.md), and [Technical Interview Guide](interview-guide.md).

---

## Interview Questions & Deep-Dive Explanations

### 1. How do you stress test race conditions in an embedded SQLite CLI without running a background server?
- **The Challenge:** Unlike client-server databases (like Postgres) where connection pools manage serialization on a separate machine, SQLite runs embedded in the Node process. Testing race conditions requires spawning multiple concurrent operations that attempt to acquire the write lock at the exact same millisecond.
- **The Test Design:**
  - In `test/concurrency.test.js`, we generate an array of concurrent promises using `Promise.all`:
    ```javascript
    const tasks = Array.from({ length: 10 }, (_, i) => 
      allocatePortRange(db, `worker-${i}`, basePort)
    );
    const results = await Promise.all(tasks);
    ```
  - We extract the allocated ranges and perform set intersection checks:
    - Every worker's `[port_start, port_end]` range must have zero overlap with every other worker's range.
    - All 10 ranges must be contiguous blocks of 10.
  - This verifies both database transactional serialization (`BEGIN IMMEDIATE`) and the port gap algorithm under maximum concurrency.

### 2. What is package bundle bloat in the npm ecosystem, and how does a `files` allowlist prevent it?
- **The Vulnerability:** By default, running `npm publish` uploads almost everything in the project root to the npm registry—including test folders, fixtures, mock databases, internal documentation, and configuration files.
- **The Consequences of Package Bloat:**
  - Slow install times for end users (`npm install` has to download and unpack unnecessary megabytes).
  - Security risks: Accidentally publishing internal secrets, local test credentials, or staging database snapshots committed to local test directories.
- **The Allowlist Solution:**
  - In `package.json`, declaring `"files": ["bin/", "src/", "README.md", "LICENSE", "CHANGELOG.md"]` creates an explicit allowlist.
  - Anything not listed (like `test/`, `docs/`, `.github/`, or `assets/`) is strictly ignored during `npm pack`.
  - Result: WorkTide ships at a lean 18.3 kB, making global installation virtually instantaneous.

### 3. How does a `prepublishOnly` lifecycle script protect package integrity?
- npm provides several lifecycle scripts: `prepare`, `prepublishOnly`, `postpublish`.
- `prepublishOnly` runs **only** on `npm publish` (it does *not* run on local `npm install`).
- By setting `"prepublishOnly": "npm test"`, the CLI automatically triggers the entire Vitest suite before creating the tarball.
- If a single test fails, the publish command aborts immediately with an exit code, preventing broken code or accidental regressions from reaching production users on npm.
