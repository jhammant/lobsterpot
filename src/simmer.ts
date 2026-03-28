/**
 * The Simmer — Lobsterpot's pot watchdog.
 * 
 * Keeps pots cooking. Detects stalls, approves prompts,
 * restarts crashed sessions, kicks idle pots.
 * 
 * Named after the cook's art of maintaining a steady simmer —
 * not too hot, not too cold, never left unattended.
 */

import { execFileSync } from 'child_process';
import { LocalTmuxBackend } from './daemon-types.js';

export interface SimmerConfig {
  /** Check interval in milliseconds (default: 5 minutes) */
  intervalMs: number;
  /** SSH connection string for remote hosts (e.g., "jhammant@ghost") */
  sshTarget?: string;
  /** Path to tmux binary */
  tmuxPath: string;
  /** Path to opencode binary */
  opencodePath: string;
  /** Auto-approve permission prompts */
  autoApprove: boolean;
  /** Auto-approve command confirmations */
  autoConfirm: boolean;
  /** Restart crashed OpenCode sessions */
  autoRestart: boolean;
  /** Kick stalled prompts (Enter key) */
  autoKick: boolean;
  /** Log callback */
  onLog?: (entry: SimmerLogEntry) => void;
}

export interface SimmerLogEntry {
  timestamp: number;
  session: string;
  action: 'active' | 'kicked' | 'approved' | 'confirmed' | 'restarted' | 'idle' | 'error';
  detail: string;
}

export interface SimmerStatus {
  active: number;
  kicked: number;
  idle: number;
  errors: number;
  lastCheck: number;
  log: SimmerLogEntry[];
}

type PotHealth = 
  | 'active'           // Spinner or progress bar moving
  | 'stalled'          // Task visible but not submitted
  | 'permission'       // Stuck on permission prompt
  | 'question'         // Stuck on multiple choice
  | 'confirmation'     // "Do you want to proceed?"
  | 'crashed'          // OpenCode exited to shell
  | 'idle'             // At empty prompt, no task
  | 'unknown';

const DEFAULT_CONFIG: SimmerConfig = {
  intervalMs: 5 * 60 * 1000,
  tmuxPath: '/opt/homebrew/bin/tmux',
  opencodePath: 'opencode',
  autoApprove: true,
  autoConfirm: true,
  autoRestart: true,
  autoKick: true,
};

export class Simmer {
  private config: SimmerConfig;
  private timer: NodeJS.Timeout | null = null;
  private status: SimmerStatus = {
    active: 0,
    kicked: 0,
    idle: 0,
    errors: 0,
    lastCheck: 0,
    log: [],
  };

  constructor(config: Partial<SimmerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.log('simmer', 'active', 'Simmer started — watching pots');
    this.check(); // Run immediately
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log('simmer', 'idle', 'Simmer stopped');
  }

  getStatus(): SimmerStatus {
    return { ...this.status };
  }

  check(): SimmerStatus {
    const sessions = this.listPotSessions();
    let active = 0, kicked = 0, idle = 0, errors = 0;

    for (const session of sessions) {
      try {
        const output = this.capturePane(session);
        const health = this.diagnose(output);

        switch (health) {
          case 'active':
            active++;
            break;

          case 'stalled':
            if (this.config.autoKick) {
              this.sendKeys(session, '', true); // Just Enter
              this.log(session, 'kicked', 'Stalled prompt — sent Enter');
              kicked++;
            } else {
              idle++;
            }
            break;

          case 'permission':
            if (this.config.autoApprove) {
              // Tab to "Allow always", then Enter
              this.sendKeys(session, '\t', false);
              this.sleep(200);
              this.sendKeys(session, '', true);
              this.log(session, 'approved', 'Permission prompt — approved');
              kicked++;
            } else {
              idle++;
              this.log(session, 'idle', 'Permission prompt — waiting for manual approval');
            }
            break;

          case 'question':
            if (this.config.autoConfirm) {
              this.sendKeys(session, '', true); // Select default (first option)
              this.log(session, 'confirmed', 'Question prompt — selected default');
              kicked++;
            } else {
              idle++;
            }
            break;

          case 'confirmation':
            if (this.config.autoConfirm) {
              this.sendKeys(session, '2', false); // "Yes, and don't ask again"
              this.sleep(100);
              this.sendKeys(session, '', true);
              this.log(session, 'confirmed', 'Confirmation prompt — selected yes-always');
              kicked++;
            } else {
              idle++;
            }
            break;

          case 'crashed':
            if (this.config.autoRestart) {
              const cmd = `export PATH=$HOME/.opencode/bin:$PATH && ${this.config.opencodePath}`;
              this.sendKeys(session, cmd, true);
              this.log(session, 'restarted', 'OpenCode crashed — relaunched');
              kicked++;
            } else {
              errors++;
              this.log(session, 'error', 'OpenCode crashed — waiting for manual restart');
            }
            break;

          case 'idle':
            idle++;
            this.log(session, 'idle', 'At empty prompt — no task assigned');
            break;

          default:
            active++;
            break;
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        this.log(session, 'error', `Check failed: ${msg}`);
      }
    }

    this.status = {
      active,
      kicked,
      idle,
      errors,
      lastCheck: Date.now(),
      log: this.status.log.slice(-100), // Keep last 100 entries
    };

    return this.status;
  }

  private diagnose(output: string): PotHealth {
    // Active: has spinner characters or reading/writing indicators
    if (/[⠴⠹⠙⠸⠼⠧⠇⠏]/.test(output)) return 'active';
    if (/→ Read|→ Write|← Write|← Read|~ Reading|~ Writing|Running/.test(output)) return 'active';

    // Active: progress bar has filled blocks (not all empty)
    const filled = (output.match(/■/g) || []).length;
    const empty = (output.match(/⬝/g) || []).length;
    if (filled > 0 && empty > 0 && filled > 0) return 'active';

    // Permission prompt
    if (/Permission required|△ Permission/.test(output)) return 'permission';

    // Multiple choice question
    if (/↑↓ select.*enter submit/.test(output)) return 'question';

    // Confirmation prompt
    if (/Do you want to proceed/.test(output)) return 'confirmation';

    // Crashed to shell (no OpenCode UI visible)
    if (/^[❯\$%] $/m.test(output) && !/Build.*LM Studio|Build.*Qwen|Build.*Claude/.test(output)) return 'crashed';

    // Idle at prompt
    if (/Ask anything/.test(output)) return 'idle';

    // Stalled: has the UI chrome but empty progress bar and no activity
    if (/ctrl\+p commands/.test(output) && /⬝⬝⬝⬝⬝⬝⬝⬝/.test(output)) {
      // Could be queued behind other pots on LM Studio — check if "esc interrupt" is shown
      if (/esc interrupt/.test(output)) return 'active'; // Has a task, just waiting for GPU
      return 'stalled';
    }

    return 'unknown';
  }

  private listPotSessions(): string[] {
    try {
      const cmd = this.buildCommand([this.config.tmuxPath, 'list-sessions', '-F', '#{session_name}']);
      const output = this.exec(cmd);
      return output.split('\n').filter(s => s.startsWith('lp-'));
    } catch {
      return [];
    }
  }

  private capturePane(session: string): string {
    const cmd = this.buildCommand([this.config.tmuxPath, 'capture-pane', '-t', session, '-p']);
    return this.exec(cmd);
  }

  private sendKeys(session: string, keys: string, enter: boolean): void {
    if (keys) {
      const cmd = this.buildCommand([this.config.tmuxPath, 'send-keys', '-t', session, '-l', '--', keys]);
      this.exec(cmd);
    }
    if (enter) {
      const cmd = this.buildCommand([this.config.tmuxPath, 'send-keys', '-t', session, 'Enter']);
      this.exec(cmd);
    }
  }

  private buildCommand(args: string[]): string[] {
    if (this.config.sshTarget) {
      return ['ssh', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', this.config.sshTarget, args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')];
    }
    return args;
  }

  private exec(args: string[]): string {
    return execFileSync(args[0], args.slice(1), {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  }

  private sleep(ms: number): void {
    execFileSync('sleep', [`${ms / 1000}`]);
  }

  private log(session: string, action: SimmerLogEntry['action'], detail: string): void {
    const entry: SimmerLogEntry = { timestamp: Date.now(), session, action, detail };
    this.status.log.push(entry);
    this.config.onLog?.(entry);
  }
}
