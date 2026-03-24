# Changelog

## [0.1.0] - 2026-03-24

### Added

- Core pot lifecycle: create, monitor, send, capture, kill via SSH + tmux
- Smart router: local-first build with expensive review phase (saves 80-90% on tokens)
- REST API for remote pot management (create, list, status, send, capture, kill)
- Mobile-friendly dark-theme dashboard with auto-refresh
- Progress tracking with structured logs, markdown reports, Discord summaries
- CLI commands: `create`, `list`, `status`, `send`, `capture`, `kill`, `serve`, `route`
- Built-in agent configs for claude-code, codex, kiro, gemini-cli, aider, goose, amp, opencode
- Typed error classes: `SSHError`, `TmuxError`, `AgentError` with actionable messages
- Agent availability check before pot creation
- Auto-nudge on stuck agents and auto-recovery on crash
- Unit tests (vitest) for router and pot-manager
- Example config (`lobsterpot.example.yaml`)
