# WorkTide 🌊

> **Instantly runnable, isolated Git worktrees for parallel branch development.**

WorkTide is a fast, developer-friendly Node.js CLI tool built to make git worktrees immediately productive and isolated. When developers or parallel workflows spin up git worktrees, fresh worktrees are inert—they lack dependencies (`node_modules`), miss environment configurations (`.env`), share state unsafely, and collide on default dev-server ports.

WorkTide eliminates this friction with automatic dependency linking, collision-free port allocation, and automated lifecycle management.

---

## ⚡ Features

- 🔗 **Automatic Dependency Linking:** Detects root `node_modules` and symlinks it into new worktrees instantly.
- 🔒 **Conflict-Free Port Allocation:** Allocates a dedicated 10-port block (e.g. `3000-3009`, `3010-3019`) per worktree via a centralized SQLite registry.
- ⚙️ **Deterministic Environment Injection:** Writes managed `PORT` and `PORT_END` variables into `.env.local` without touching custom user keys.
- 📊 **Real-time Status Dashboard:** Inspect active worktrees, assigned ports, and process liveness (`live` / `down`) in a clean terminal table or `--json`.
- 🧹 **Safe Graceful Teardown:** Inspects only allocated ports, terminates lingering listeners (`SIGTERM` -> `SIGKILL`), verifies git cleanliness, and cleans up worktrees.
- 🩺 **Self-Healing Doctor:** Detects and auto-repairs orphaned allocations, broken symlinks, and stale git locks with `worktide doctor --fix`.

---

## 📦 Requirements

- **Node.js:** `>= 18.0.0`
- **Git:** `>= 2.20` (supporting `git worktree`)
- **OS:** Linux or macOS (Windows not officially supported in v1)

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/worktide.git
cd worktide

# Install dependencies
npm install

# Link CLI locally
npm link
```

### Basic Commands

```bash
# 1. Start a fully provisioned worktree for a branch
worktide start feature/auth

# 2. View all active worktrees and their allocated ports
worktide status

# 3. Check and repair system health
worktide doctor --fix

# 4. Safely tear down a worktree when finished
worktide done feature/auth
```

---

## 🛠️ CLI Reference

| Command | Description |
|---|---|
| `worktide start <branch>` | Create a git worktree, symlink dependencies, copy `.env*`, and allocate a 10-port block. |
| `worktide status [--json] [--all]` | List active worktrees, paths, ports, and server liveness status. |
| `worktide done <branch> [--force]` | Terminate active processes on allocated ports, remove worktree, and release ports. |
| `worktide doctor [--fix]` | Inspect and heal inconsistencies between filesystem, git state, and registry. |

---

## 🧩 How It Works

```
                        worktide start <branch>
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
 1. Symlink Dependencies   2. Allocate Ports        3. Inject Config
    root/node_modules        SQLite Registry           .env.local
           │                 (Port: 3010-3019)       PORT=3010
           ▼                       │                 PORT_END=3019
    worktree/node_modules          ▼                       │
                             lsof verification             ▼
                                   └───────────────► Fully Isolated Worktree
```

---

## 📁 Repository Structure

```
worktide/
├── bin/                 # CLI executable entrypoint
├── src/
│   ├── cli.js           # Commander command definitions
│   ├── commands/        # CLI command handlers (start, status, done, doctor)
│   ├── db/              # SQLite registry and migrations
│   ├── services/        # Git, port allocator, env manager, process supervisor
│   └── utils/           # Structured errors, logger, slug generator
├── docs/                # System architecture, SRS, and design documentation
├── examples/            # Example workflows and configurations
├── test/                # Vitest automated test suite
├── CHANGELOG.md         # Release history and unreleased features
├── ROADMAP.md           # Milestone roadmap and delivery tracking
└── LICENSE              # MIT License
```

---

## 🧪 Testing

```bash
# Run test suite
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 📄 License

[MIT](file:///d:/Programming/Resume%20Projects/WokTide/LICENSE) © Harsh Vats
