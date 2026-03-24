---
name: lobsterpot
description: Remote-control coding agents (Claude Code, Codex, Aider) on remote machines via SSH + tmux. Manage multiple concurrent sessions, monitor progress, auto-recover from errors.
metadata:
  { "openclaw": { "emoji": "🦞", "os": ["darwin", "linux"], "requires": { "bins": ["ssh"] } } }
---

# 🦞 LobsterPot — Remote Coding Agent Orchestrator

Manage coding agent sessions on remote machines via SSH + tmux. You are the control plane.

## When to Use

✅ **USE when:**
- User asks to run a coding task on a remote machine
- User wants Claude Code / Codex / Aider running on their Mac while they're away
- Managing multiple concurrent coding sessions
- User says "keep it going" / "monitor it" / "check on the build"

❌ **DON'T use when:**
- Simple one-off commands → use `exec` directly
- Local coding tasks → use `sessions_spawn` with ACP
- User is actively watching the session themselves

## Quick Reference

### Start a Pot (New Session)

```bash
# SSH to machine, create tmux session, launch agent, send task
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux new-session -d -s lp-NAME -c REPO_PATH'
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux send-keys -t lp-NAME "claude" Enter'
# Wait 3-5s for agent to load
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux send-keys -t lp-NAME -l -- "TASK" && sleep 0.1 && tmux send-keys -t lp-NAME Enter'
```

### Monitor a Pot

```bash
# Capture last N lines of output
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux capture-pane -t lp-NAME -p | tail -40'
```

### Send a Message

```bash
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux send-keys -t lp-NAME -l -- "MESSAGE" && sleep 0.1 && tmux send-keys -t lp-NAME Enter'
```

### Kill a Pot

```bash
ssh USER@HOST 'export PATH="/opt/homebrew/bin:$PATH" && tmux kill-session -t lp-NAME'
```

## State Detection

Check captured output for these patterns:

| State | Pattern | Action |
|-------|---------|--------|
| **Running** | `Nucleating`, `thinking`, `Cooked`, active tool calls | Let it work |
| **Waiting** | `❯` prompt at bottom, no activity | Send next instruction |
| **Stuck** | `Yes/No`, `proceed?`, `permission`, `y/n` | Auto-approve or ask user |
| **Error** | `Error:`, `OOM`, `killed`, `panic` | Attempt recovery |
| **Loading** | `Loading model`, downloading | Wait |

## Recovery Protocol

1. Capture last output for context
2. Kill the tmux session
3. Create new session, restart agent
4. Send: "Previous session crashed. Resume task: {original_task}. Last state: {last_output}"

## Monitoring Cron

Set up a cron job to check every 10 minutes:

```
Schedule: every 600000ms
Action: SSH capture pane, check state, nudge if stuck, report if milestone/error
Only message user if: error, significant milestone, or stuck and needs human decision
```

## Multi-Agent Strategy

| Task Complexity | Agent | Cost |
|----------------|-------|------|
| Exploration, simple iteration | aider + local model | Free |
| Medium complexity, bulk work | aider + OpenRouter free | Free |
| Complex architecture | Claude Code | $$$ |
| Broad coding tasks | Codex | $$ |
| Research/analysis | Gemini CLI | $$ |

## Channel Strategy (Discord)

- Each pot gets a **thread** in #builder for detailed logs
- **#general** for milestone summaries and user-facing updates
- Thread name format: `🦞 {pot-name} — {short-task}`

## Example Interaction

```
User: "Start my-project on dev-box, focus on speed optimisation"
Echo: 
  1. SSH to dev-box
  2. tmux new-session -d -s lp-my-project -c ~/dev/my-project
  3. Start claude-code in the session
  4. Send task: "Optimise inference speed..."
  5. Set up 10-min monitoring cron
  6. Report: "🦞 Pot 'my-project' running on dev-box with Claude Code"

User: "How's my-project going?"
Echo:
  1. SSH capture-pane lp-my-project
  2. Analyse output
  3. Report status with key findings

User: "Tell it to focus on KV cache"
Echo:
  1. tmux send-keys "Focus on KV cache optimisation..."
  2. Confirm: "Sent direction to my-project"
```
