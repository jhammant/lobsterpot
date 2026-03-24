import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import {
  Pot, PotConfig, PotState, LobsterPotConfig,
  AgentConfig, DEFAULT_AGENTS, Milestone, PotError
} from './types.js';

export class SSHError extends Error {
  constructor(
    message: string,
    public readonly machine: string,
    public readonly cause?: string,
  ) {
    super(message);
    this.name = 'SSHError';
  }
}

export class TmuxError extends Error {
  constructor(message: string, public readonly session?: string) {
    super(message);
    this.name = 'TmuxError';
  }
}

export class AgentError extends Error {
  constructor(message: string, public readonly agent: string) {
    super(message);
    this.name = 'AgentError';
  }
}

export class PotManager {
  private pots: Map<string, Pot> = new Map();
  private config: LobsterPotConfig;
  private monitors: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: LobsterPotConfig) {
    this.config = config;
  }

  private ssh(machine: string, command: string, timeoutS = 10): string {
    const mc = this.config.machines[machine];
    if (!mc) throw new Error(`Unknown machine: ${machine}`);
    const keyArg = mc.key ? `-i ${mc.key}` : '';
    const cmd = `ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${keyArg} ${mc.user}@${mc.host} ${JSON.stringify(command)}`;
    try {
      return execSync(cmd, { timeout: timeoutS * 1000, encoding: 'utf-8' });
    } catch (e: any) {
      const stderr = (e.stderr || e.message || '').toString();
      // SSH connection failures
      if (stderr.includes('Connection refused') || stderr.includes('Connection timed out') || stderr.includes('No route to host')) {
        throw new SSHError(`Cannot connect to ${mc.host}: ${stderr.trim()}`, machine, stderr);
      }
      if (stderr.includes('Permission denied') || stderr.includes('Authentication failed')) {
        throw new SSHError(`SSH authentication failed for ${mc.user}@${mc.host}. Check your key at ${mc.key || '(default)'}`, machine, stderr);
      }
      // Timeout from execSync
      if (e.killed || stderr.includes('ETIMEDOUT')) {
        throw new SSHError(`SSH command timed out after ${timeoutS}s on ${machine}`, machine, stderr);
      }
      // tmux not found
      if (stderr.includes('tmux: not found') || stderr.includes('command not found: tmux')) {
        throw new TmuxError(`tmux is not installed on ${machine}. Install it with: apt install tmux (or brew install tmux)`);
      }
      return e.stdout || stderr || e.message;
    }
  }

  private tmuxCmd(machine: string, tmuxSession: string, action: string): string {
    return this.ssh(machine, `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && tmux ${action} -t ${tmuxSession}`);
  }

  async create(potConfig: PotConfig): Promise<Pot> {
    const id = potConfig.name || randomUUID().slice(0, 8);
    const tmuxSession = `lp-${id}`;

    const pot: Pot = {
      id,
      config: potConfig,
      state: 'creating',
      tmuxSession,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      lastOutput: '',
      milestones: [],
      errors: [],
    };

    this.pots.set(id, pot);

    // Verify agent is available on the target machine
    const agentConfig = this.getAgentConfig(potConfig.agent);
    const agentBinary = agentConfig.command.split(' ')[0];
    const whichResult = this.ssh(potConfig.machine, `which ${agentBinary} 2>/dev/null || echo __NOT_FOUND__`, 10);
    if (whichResult.includes('__NOT_FOUND__')) {
      this.pots.delete(id);
      throw new AgentError(
        `Agent "${potConfig.agent}" (binary: ${agentBinary}) is not installed on machine "${potConfig.machine}". ` +
        `Install it first, or choose a different agent with --agent.`,
        potConfig.agent,
      );
    }

    // Create tmux session and start agent
    const startCmd = [
      `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`,
      `tmux new-session -d -s ${tmuxSession} -c ${potConfig.repo}`,
      `sleep 0.5`,
      `tmux send-keys -t ${tmuxSession} '${agentConfig.command}' Enter`,
    ].join(' && ');

    this.ssh(potConfig.machine, startCmd, 15);
    pot.state = 'loading';
    pot.lastActivity = Date.now();

    // Wait for agent to be ready, then send task
    setTimeout(() => this.sendTask(id), 5000);

    // Start monitoring
    this.startMonitor(id);

    return pot;
  }

  private async sendTask(potId: string): Promise<void> {
    const pot = this.pots.get(potId);
    if (!pot) return;

    const { machine } = pot.config;
    const task = pot.config.task.replace(/'/g, "'\\''");

    this.ssh(machine,
      `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && ` +
      `tmux send-keys -t ${pot.tmuxSession} -l -- '${task}' && ` +
      `sleep 0.1 && ` +
      `tmux send-keys -t ${pot.tmuxSession} Enter`,
      10
    );

    pot.state = 'running';
    pot.lastActivity = Date.now();
    pot.milestones.push({ timestamp: Date.now(), description: 'Task sent' });
  }

  capture(potId: string, lines = 40): string {
    const pot = this.pots.get(potId);
    if (!pot) throw new Error(`Unknown pot: ${potId}`);

    const output = this.tmuxCmd(pot.config.machine, pot.tmuxSession, `capture-pane -p`);
    const trimmed = output.split('\n').slice(-lines).join('\n');
    pot.lastOutput = trimmed;
    pot.lastActivity = Date.now();
    return trimmed;
  }

  send(potId: string, message: string): void {
    const pot = this.pots.get(potId);
    if (!pot) throw new Error(`Unknown pot: ${potId}`);

    const escaped = message.replace(/'/g, "'\\''");
    this.ssh(pot.config.machine,
      `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && ` +
      `tmux send-keys -t ${pot.tmuxSession} -l -- '${escaped}' && ` +
      `sleep 0.1 && ` +
      `tmux send-keys -t ${pot.tmuxSession} Enter`,
      10
    );

    pot.lastActivity = Date.now();
  }

  kill(potId: string): void {
    const pot = this.pots.get(potId);
    if (!pot) throw new Error(`Unknown pot: ${potId}`);

    // Stop monitor
    const monitor = this.monitors.get(potId);
    if (monitor) clearInterval(monitor);
    this.monitors.delete(potId);

    // Kill tmux session
    this.tmuxCmd(pot.config.machine, pot.tmuxSession, 'kill-session');
    pot.state = 'killed';
  }

  list(): Pot[] {
    return Array.from(this.pots.values());
  }

  get(potId: string): Pot | undefined {
    return this.pots.get(potId);
  }

  private startMonitor(potId: string): void {
    const pot = this.pots.get(potId);
    if (!pot) return;

    const intervalMs = pot.config.checkIntervalMs || this.config.monitoring?.checkIntervalMs || 30000;

    const monitor = setInterval(() => {
      this.checkPot(potId);
    }, intervalMs);

    this.monitors.set(potId, monitor);
  }

  private checkPot(potId: string): { state: PotState; analysis: string } {
    const pot = this.pots.get(potId);
    if (!pot || pot.state === 'killed' || pot.state === 'done') {
      return { state: pot?.state || 'killed', analysis: 'Pot is not active' };
    }

    const output = this.capture(potId);
    const agentConfig = this.getAgentConfig(pot.config.agent);

    // Check for errors
    for (const pattern of agentConfig.errorPatterns || []) {
      if (new RegExp(pattern, 'i').test(output)) {
        const error: PotError = {
          timestamp: Date.now(),
          type: this.classifyError(output),
          message: output.split('\n').slice(-5).join('\n'),
          recovered: false,
        };
        pot.errors.push(error);

        if (pot.config.autoRecover !== false) {
          pot.state = 'recovering';
          this.recover(potId);
        } else {
          pot.state = 'error';
        }
        return { state: pot.state, analysis: `Error detected: ${error.type}` };
      }
    }

    // Check for stuck
    for (const pattern of agentConfig.stuckPatterns || []) {
      if (new RegExp(pattern, 'i').test(output)) {
        pot.state = 'stuck';
        if (pot.config.autoNudge !== false) {
          this.nudge(potId);
        }
        return { state: 'stuck', analysis: 'Agent waiting for input — nudged' };
      }
    }

    // Check for idle (no output change)
    const stuckThreshold = (pot.config.stuckThresholdS || this.config.monitoring?.stuckThresholdS || 300) * 1000;
    if (Date.now() - pot.lastActivity > stuckThreshold && pot.lastOutput === output) {
      pot.state = 'stuck';
      return { state: 'stuck', analysis: 'No output change — possibly stuck' };
    }

    pot.state = 'running';
    return { state: 'running', analysis: 'Active' };
  }

  private nudge(potId: string): void {
    this.send(potId, 'Continue working. Keep iterating and making progress. Don\'t stop to ask — just build.');
  }

  private recover(potId: string): void {
    const pot = this.pots.get(potId);
    if (!pot) return;

    const retries = pot.errors.filter(e => e.recovered).length;
    const maxRetries = pot.config.maxRetries || 3;

    if (retries >= maxRetries) {
      pot.state = 'error';
      return;
    }

    // Kill and restart
    this.tmuxCmd(pot.config.machine, pot.tmuxSession, 'kill-session');

    setTimeout(() => {
      const agentConfig = this.getAgentConfig(pot.config.agent);
      const startCmd = [
        `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`,
        `tmux new-session -d -s ${pot.tmuxSession} -c ${pot.config.repo}`,
        `sleep 0.5`,
        `tmux send-keys -t ${pot.tmuxSession} '${agentConfig.command}' Enter`,
      ].join(' && ');

      this.ssh(pot.config.machine, startCmd, 15);

      setTimeout(() => {
        const context = `Previous session crashed. Resume the task: ${pot.config.task}. Last known state: ${pot.lastOutput.slice(-500)}`;
        this.send(potId, context);
        pot.state = 'running';
        pot.errors[pot.errors.length - 1].recovered = true;
      }, 5000);
    }, 2000);
  }

  private classifyError(output: string): PotError['type'] {
    const lower = output.toLowerCase();
    if (lower.includes('oom') || lower.includes('out of memory') || lower.includes('cannot allocate')) return 'oom';
    if (lower.includes('killed') || lower.includes('segmentation fault') || lower.includes('panic')) return 'crash';
    if (lower.includes('timeout')) return 'timeout';
    return 'unknown';
  }

  private getAgentConfig(agentName: string): AgentConfig {
    return this.config.agents?.[agentName] || DEFAULT_AGENTS[agentName] || DEFAULT_AGENTS['claude-code'];
  }
}
