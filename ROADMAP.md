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

## 🟡 Phase 1: Database Registry & Port Allocator (In Progress)

- [ ] Implement SQLite connection manager with WAL mode and `PRAGMA foreign_keys = ON`
- [ ] Schema migrations: `repos`, `worktrees`, and `port_allocations` tables
- [ ] Implement collision-free port allocation algorithm with gap reuse (base port `3000`, 10 ports per block)
- [ ] OS socket probe with `net.createServer` to verify port vacancy before reserving
- [ ] Unit & integration tests for transactional concurrency and port isolation

---

## 🟡 Phase 2: Worktree Provisioning (`worktide start`)

- [ ] Git service using `execa`: repo root detection, branch slugification, worktree creation
- [ ] Automatic dependency linking (symlinking root `node_modules` into worktree)
- [ ] Environment file propagation (`.env*` copy)
- [ ] Managed `.env.local` block injection (`PORT` & `PORT_END` delimited with markers)
- [ ] Comprehensive atomic rollback on provisioning failure (reverse undo)
- [ ] Idempotent re-runs handling

---

## ⚪ Phase 3: Status & Teardown (`worktide status` & `worktide done`)

- [ ] `worktide status` table reporting active worktrees, branches, ports, and socket liveness
- [ ] `--json` flag support for automated scripting and tooling
- [ ] Process inspection via `lsof` strictly scoped to allocated port ranges
- [ ] Graceful termination sequence (`SIGTERM` followed by `SIGKILL` timeout)
- [ ] Dirty git check preventing accidental loss of uncommitted work unless `--force` is supplied
- [ ] Worktree removal and port deallocation in SQLite

---

## ⚪ Phase 4: Self-Healing & Health Doctor (`worktide doctor`)

- [ ] Detect broken `node_modules` symlinks
- [ ] Detect orphaned allocations (DB record present, but worktree deleted from disk)
- [ ] Detect stale `.git/index.lock` files
- [ ] `--fix` automated self-healing repair routines

---

## 🔮 Future Horizons (v2+)

- [ ] Multi-stack dependency linking (Python `venv`, pnpm virtual store, Bun)
- [ ] Webhook / event triggers for dev-server automated startup
- [ ] TUI dashboard view for active worktrees and process output
