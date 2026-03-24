# 🦞 LobsterPot

**Remote coding agent orchestrator** — manage multiple AI coding sessions from your chat interface.

LobsterPot lets an AI assistant (like [OpenClaw](https://github.com/openclaw/openclaw)) SSH into remote machines, spin up coding agents in tmux sessions, keep them working, handle errors, and report progress — all while you steer from Discord, Slack, or any chat.

## The Pattern

```
You (Discord/Chat) ←→ OpenClaw (Echo) ←→ SSH ←→ tmux ←→ Coding Agent ←→ Your Code
                         ↕                                    ↕
                    Status Updates                     Auto-Recovery
                    Discord Channels                   Progress Logs
```

**You say:** "Build me a REST API for user auth"  
**LobsterPot:** SSHs to your Mac, opens Claude Code in tmux, sends the task, monitors progress, reports back, nudges when stuck, recovers from crashes.

## Features

- 🔄 **Multi-session** — run multiple "pots" simultaneously on one or more machines
- 🤖 **Multi-agent** — Claude Code, Codex, Aider, local models (Ollama/MLX), OpenRouter free models
- 📊 **Live monitoring** — TUI dashboard on the host machine, chat updates for remote control
- 🔁 **Auto-recovery** — detects crashes, OOM, stuck prompts; restarts with context
- 📢 **Discord channels** — each pot gets a dedicated channel/thread for updates
- 📝 **Progress logs** — structured logs with milestones, benchmarks, decisions
- 💰 **Token-aware** — routes to free/local models when possible, saves API tokens for complex work

## Supported Agents

| Agent | Type | Cost | Best For |
|-------|------|------|----------|
| Claude Code | Cloud CLI | $$$ | Complex architecture, refactoring |
| Codex | Cloud CLI | $$ | Broad coding tasks |
| Aider + local model | Local | Free | Iteration, simple changes |
| Aider + OpenRouter | Cloud API | Free* | Medium complexity, bulk work |
| MLX local models | Local | Free | Fast iteration on Apple Silicon |
| Gemini CLI | Cloud CLI | $$ | Research, analysis |

\* OpenRouter free tier models

## Quick Start

### As an OpenClaw Skill

```bash
# Install the skill
cp -r lobsterpot/skill ~/.openclaw/workspace/skills/lobsterpot

# Tell Echo:
"Start a lobsterpot session on ghost — expertflow repo, focus on speed optimisation"
```

### As a CLI (on the host machine)

```bash
npm install -g lobsterpot

# Start the TUI dashboard
lobsterpot tui

# Create a new pot
lobsterpot create \
  --name "expertflow" \
  --repo ~/dev/expertflow \
  --agent claude-code \
  --task "Optimise inference speed for 200B+ MoE models"

# List active pots
lobsterpot list

# Check status
lobsterpot status expertflow

# Send a message to a pot
lobsterpot send expertflow "Focus on KV cache optimisation next"
```

## Architecture

```
┌─────────────────────────────────────┐
│           LobsterPot CLI            │
│  ┌─────────┐  ┌──────────────────┐  │
│  │   TUI   │  │   REST API       │  │
│  │Dashboard │  │  (for OpenClaw)  │  │
│  └─────────┘  └──────────────────┘  │
├─────────────────────────────────────┤
│           Pot Manager               │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│  │Pot 1│ │Pot 2│ │Pot 3│ │Pot N│  │
│  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘  │
├─────┼────────┼───────┼───────┼──────┤
│     │  tmux Session Manager  │      │
│  ┌──┴──┐ ┌──┴──┐ ┌──┴──┐ ┌──┴──┐  │
│  │tmux │ │tmux │ │tmux │ │tmux │  │
│  │sess │ │sess │ │sess │ │sess │  │
│  └─────┘ └─────┘ └─────┘ └─────┘  │
└─────────────────────────────────────┘
```

### Pot Lifecycle

```
CREATE → LOADING → RUNNING → (STUCK?) → NUDGE → RUNNING → DONE
                      ↓                              ↓
                    ERROR → RECOVERING → RUNNING    CRASH → RECOVERING
```

## Configuration

```yaml
# ~/.lobsterpot/config.yaml
machines:
  ghost:
    host: ghost  # SSH config name or IP
    user: jhammant
    default_agent: claude-code
    models_dir: ~/models  # For local models

agents:
  claude-code:
    command: claude
    type: interactive-tui
    cost_tier: high
    
  aider-local:
    command: aider --model ollama/qwen2.5-coder:32b
    type: interactive-tui
    cost_tier: free
    
  aider-openrouter:
    command: aider --model openrouter/nvidia/nemotron-3-super-120b-a12b:free
    type: interactive-tui
    cost_tier: free

  codex:
    command: codex
    type: interactive-tui
    cost_tier: medium

channels:
  discord:
    guild_id: "1467844413870051542"
    category: "lobsterpot"  # Auto-create channels under this category
    
monitoring:
  check_interval_ms: 30000
  stuck_threshold_s: 300  # 5 min with no output = stuck
  auto_nudge: true
  auto_recover: true
```

## Token Strategy

LobsterPot is smart about which agent to use:

1. **Exploration/iteration** → Local models or OpenRouter free (zero cost)
2. **Complex architecture** → Claude Code or Codex (paid)
3. **Bulk changes** → Aider + local model (free, fast)
4. **Research/analysis** → Gemini CLI (paid but cheaper)

You can set this per-pot or let LobsterPot auto-route based on task complexity.

## OpenClaw Integration

LobsterPot works as an OpenClaw skill. Echo can:

- Create/destroy pots on command
- Monitor all active pots
- Relay your chat messages as pot instructions
- Report milestones and errors
- Auto-manage the Discord channel structure

```
You: "Spin up a pot for gambit on ghost, use aider with the free OpenRouter model"
Echo: Creates tmux session, starts aider, sends task, monitors, reports back
```

## Development

```bash
git clone https://github.com/jhammant/lobsterpot.git
cd lobsterpot
npm install
npm run build
npm link  # For local development
```

## License

MIT

## Name

Why LobsterPot? You set the pot, drop it in, and check back later to see what you caught. 🦞
