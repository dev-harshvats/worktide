# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Core architecture and System Design specification ([docs/DESIGN.md](docs/DESIGN.md)).
- Software Requirements Specification ([docs/SRS.md](docs/SRS.md)).
- Centralized port allocator and SQLite registry architecture.
- Worktree lifecycle manager (`start`, `status`, `done`, `doctor`).

---

## [0.1.0] - 2026-10-22

### Added
- Initial project skeleton with Commander-based CLI executable.
- Custom structured error hierarchy (`WorktideError`, `ValidationError`, `GitError`, `PortAllocationError`, `ProcessError`).
- Formatted console logger with support for quiet mode and exit code mapping.
- Vitest automated test suite setup and initial unit tests.
- MIT License and project manifest.
