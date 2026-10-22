# WorkTide Roadmap 🗺️

This document outlines the development phases, milestones, and upcoming capabilities planned for WorkTide.

---

## 🟢 Phase 0: Project Setup & Architecture (Completed)

- [x] Approve Software Requirements Specification ([docs/SRS.md](docs/SRS.md))
- [x] Approve System Design & Architecture ([docs/DESIGN.md](docs/DESIGN.md))
- [x] Initialize Node.js CLI project with Commander & Vitest
- [x] Setup structured errors and logging utilities
- [x] Configure repository standards, clean `.gitignore`, and open-source documentation

---

## 🟢 Phase 1: Database Registry & Port Allocator (Completed)

- [x] Implement SQLite connection manager with WAL mode and `PRAGMA foreign_keys = ON`
- [x] Schema migrations: `repos`, `worktrees`, and `port_allocations` tables
- [x] Implement collision-free port allocation algorithm with gap reuse (base port `3000`, 10 ports per block)
- [x] OS socket probe with `net.createServer` to verify port vacancy before reserving
- [x] Unit & integration tests for transactional concurrency and port isolation

---

## 🟢 Phase 2: Worktree Provisioning (`worktide start`) (Completed)

- [x] Git service using `execa`: repo root detection, branch slugification, worktree creation
- [x] Automatic dependency linking (symlinking root `node_modules` into worktree)
- [x] Environment file propagation (`.env*` copy)
- [x] Managed `.env.local` block injection (`PORT` & `PORT_END` delimited with markers)
- [x] Comprehensive atomic rollback on provisioning failure (reverse undo)
- [x] Idempotent re-runs handling

---

## 🟢 Phase 3: Status & Teardown (`worktide status` & `worktide done`) (Completed)

- [x] `worktide status` table reporting active worktrees, branches, ports, and socket liveness
- [x] `--json` flag support for automated scripting and tooling
- [x] Process inspection via `lsof` strictly scoped to allocated port ranges
- [x] Graceful termination sequence (`SIGTERM` followed by `SIGKILL` timeout)
- [x] Dirty git check preventing accidental loss of uncommitted work unless `--force` is supplied
- [x] Worktree removal and port deallocation in SQLite

---

## 🟢 Phase 4: Self-Healing & Health Doctor (`worktide doctor`) (Completed)

- [x] Detect broken `node_modules` symlinks
- [x] Detect orphaned allocations (DB record present, but worktree deleted from disk)
- [x] Detect stale `.git/index.lock` files
- [x] `--fix` automated self-healing repair routines

---

## 🟢 Phase 5: Hardening & Concurrency Audit (Completed)

- [x] Parallel concurrency stress tests (10 simultaneous worker allocations with zero collisions)
- [x] Edge-case branch slugification and managed block corruption recovery
- [x] Explicit POSIX exit codes verification across all domain errors
- [x] Technical Interview and System Design Guide ([docs/learning/interview-guide.md](docs/learning/interview-guide.md))

---

## 🔮 Future Horizons (v2+)

- [ ] Multi-stack dependency linking (Python `venv`, pnpm virtual store, Bun)
- [ ] Webhook / event triggers for dev-server automated startup
- [ ] TUI dashboard view for active worktrees and process output
