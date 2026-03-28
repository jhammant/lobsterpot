import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { analyzeTranscript } from './daemon-patterns.js';
import {
  ControlPlaneDeps,
  ControlPlaneState,
  CreateLocalPotRequest,
  LocalTmuxBackend,
  LobsterPotDaemonConfig,
  PersistedDaemonState,
  PotInspection,
  PotRuntimeMetadata,
  PotStatus,
  SmartDecisionClient,
  WebhookClient,
  resolveLocalAgent,
} from './daemon-types.js';
import { CheapSmartLlmClient } from './cheap-llm.js';
import { LocalTmuxSessionBackend } from './local-tmux.js';
import { HttpWebhookClient } from './webhook-client.js';

interface PotActionTimestamps {
  lastNudgeAt?: number;
  lastCompactAt?: number;
  lastRestartAt?: number;
  lastMilestone?: string;
  lastWebhookState?: ControlPlaneState;
}

export class ControlPlaneDaemon {
  private readonly pots = new Map<string, PotStatus>();
  private readonly metadata = new Map<string, PotRuntimeMetadata>();
  private readonly actionTimestamps = new Map<string, PotActionTimestamps>();
  private readonly tmux: LocalTmuxBackend;
  private readonly llm: SmartDecisionClient;
  private readonly webhook: WebhookClient;
  private readonly now: () => number;
  private readonly intervalFn: typeof global.setInterval;
  private readonly clearIntervalFn: typeof global.clearInterval;
  private readonly timeoutFn: typeof global.setTimeout;
  private monitor?: NodeJS.Timeout;
  private readonly stateFile: string;

  constructor(
    private readonly config: LobsterPotDaemonConfig,
    deps: ControlPlaneDeps = {},
  ) {
    this.tmux = deps.tmux ?? new LocalTmuxSessionBackend();
    this.llm = deps.llm ?? new CheapSmartLlmClient(config);
    this.webhook = deps.webhook ?? new HttpWebhookClient(config);
    this.now = deps.now ?? (() => Date.now());
    this.intervalFn = deps.setInterval ?? global.setInterval;
    this.clearIntervalFn = deps.clearInterval ?? global.clearInterval;
    this.timeoutFn = deps.setTimeout ?? global.setTimeout;
    this.stateFile = join(config.stateDir, 'daemon-state.json');
  }

  private isFreeAgent(agent: string): boolean {
    return agent === 'opencode' || 
           agent.includes('local') || 
           agent.includes('openrouter');
  }

  start(): void {
    this.loadState();
    this.discoverSessions();
    void this.pollOnce();
    this.monitor = this.intervalFn(() => {
      void this.pollOnce();
    }, this.config.monitoring.checkIntervalMs);
  }

  stop(): void {
    if (this.monitor) {
      this.clearIntervalFn(this.monitor);
      this.monitor = undefined;
    }
    this.persistState();
  }

  async pollOnce(): Promise<void> {
    this.discoverSessions();
    const ids = Array.from(new Set([...this.metadata.keys(), ...this.pots.keys()]));
    for (const id of ids) {
      await this.inspectPot(id);
    }
    this.persistState();
  }

  listPots(): PotStatus[] {
    return Array.from(this.pots.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  getPot(id: string): PotStatus | undefined {
    return this.pots.get(id);
  }

  async createPot(request: CreateLocalPotRequest): Promise<PotStatus> {
    const id = request.id ?? randomUUID().slice(0, 8);
    const session = `lp-${id}`;
    const agentConfig = resolveLocalAgent(request.agent, this.config);
    const command = request.command ?? agentConfig.command;
    const now = this.now();

    this.tmux.createSession(session, request.repoPath, command);

    const pot: PotStatus = {
      id,
      session,
      agent: request.agent,
      repoPath: request.repoPath,
      state: 'starting',
      task: request.task,
      createdAt: now,
      lastSeenAt: now,
      lastChangeAt: now,
      lastOutput: '',
      alerts: [],
      signals: [],
      restarts: 0,
      nudges: 0,
      compactions: 0,
      inspectionReason: 'created',
    };
    this.pots.set(id, pot);
    this.metadata.set(id, {
      id,
      session,
      repoPath: request.repoPath,
      agent: request.agent,
      command,
      task: request.task,
      createdAt: now,
      lastKnownState: 'starting',
    });
    this.persistState();

    this.timeoutFn(() => {
      this.sendPrompt(id, request.task).catch(() => {
        // The monitor loop will surface failures on the next pass.
      });
    }, 4000);

    return pot;
  }

  async nudgePot(id: string, prompt?: string): Promise<PotStatus> {
    const message =
      prompt ??
      'Continue working autonomously. Keep making concrete progress, run checks when useful, and do not stop at an intermediate note.';
    await this.sendPrompt(id, message);
    const pot = this.requirePot(id);
    pot.nudges += 1;
    return pot;
  }

  async compactPot(id: string): Promise<PotStatus> {
    const pot = this.requirePot(id);
    const command = compactCommandForAgent(pot.agent);
    this.tmux.sendKeys(pot.session, command, true);
    pot.compactions += 1;
    pot.state = 'compacting';
    pot.inspectionReason = `manual compact: ${command}`;
    this.touchAction(id, { lastCompactAt: this.now() });
    return pot;
  }

  killPot(id: string): PotStatus {
    const pot = this.requirePot(id);
    if (this.tmux.hasSession(pot.session)) {
      this.tmux.killSession(pot.session);
    }
    pot.state = 'killed';
    pot.inspectionReason = 'killed via API';
    return pot;
  }

  private discoverSessions(): void {
    const sessions = this.tmux.listSessions().filter(session => session.startsWith('lp-'));
    for (const session of sessions) {
      const id = session.replace(/^lp-/, '');
      const known = this.pots.get(id);
      if (known) continue;

      const meta = this.metadata.get(id);
      const repoPath = meta?.repoPath ?? this.safeCurrentPath(session);
      const agent = meta?.agent ?? 'opencode';
      const now = this.now();
      this.pots.set(id, {
        id,
        session,
        agent,
        repoPath,
        state: 'running',
        task: meta?.task,
        createdAt: meta?.createdAt ?? now,
        lastSeenAt: now,
        lastChangeAt: now,
        lastOutput: '',
        alerts: [],
        signals: [],
        restarts: 0,
        nudges: 0,
        compactions: 0,
        inspectionReason: 'discovered existing tmux session',
      });

      if (!meta) {
        const command = resolveLocalAgent(agent, this.config).command;
        this.metadata.set(id, {
          id,
          session,
          repoPath,
          agent,
          command,
          createdAt: now,
        });
      }
    }
  }

  private async inspectPot(id: string): Promise<void> {
    const pot = this.pots.get(id);
    const meta = this.metadata.get(id);
    if (!pot || !meta || pot.state === 'killed') return;

    const now = this.now();
    const hasSession = this.tmux.hasSession(pot.session);
    const output = hasSession ? this.tmux.capturePane(pot.session, this.config.monitoring.captureLines) : pot.lastOutput;
    const changed = output !== pot.lastOutput;
    if (changed) pot.lastChangeAt = now;
    pot.lastSeenAt = now;
    if (hasSession) pot.lastOutput = output;

    const inspection = analyzeTranscript({
      agent: pot.agent,
      output: pot.lastOutput,
      changed,
      idleMs: now - pot.lastChangeAt,
      monitoring: this.config.monitoring,
      sessionMissing: !hasSession,
    });

    await this.applyInspection(pot, meta, inspection);
  }

  private shouldAutoApprove(pot: PotStatus, inspection: PotInspection): boolean {
    if (!inspection.approvalRequired) return false;
    
    const freeAgent = pot.agent === 'opencode' || 
                      pot.agent.includes('local') || 
                      inspection.rawMatches.some(m => m.toLowerCase().includes('[y/n]'));
    
    return freeAgent;
  }

  private async applyInspection(
    pot: PotStatus,
    meta: PotRuntimeMetadata,
    inspection: PotInspection,
  ): Promise<void> {
    const now = this.now();
    pot.inspectionReason = inspection.reason;
    pot.contextUsagePct = inspection.contextUsagePct;
    
    if (inspection.blocked) {
      pot.state = 'blocked';
      this.recordSignal(pot, 'blocked', inspection.reason);
      if (this.config.monitoring.autoNudge && this.canNudge(pot.id, now)) {
        await this.nudgePot(pot.id);
        pot.inspectionReason = `${inspection.reason}; auto-nudged from blocked state`;
      }
    }
    
    if (inspection.milestone) {
      pot.milestone = inspection.milestone;
      this.recordSignal(pot, 'milestone', inspection.milestone);
      const actionState = this.actionTimestamps.get(pot.id);
      if (actionState?.lastMilestone !== inspection.milestone) {
        this.touchAction(pot.id, { lastMilestone: inspection.milestone });
        await this.webhook.send('pot.milestone', pot, { milestone: inspection.milestone });
      }
    }

    if (inspection.contextUsagePct !== undefined && inspection.contextUsagePct >= this.config.monitoring.contextCompactThresholdPct) {
      this.recordAlert(pot, 'context', `context at ${inspection.contextUsagePct}%`);
    }
    if (inspection.approvalRequired) {
      this.recordAlert(pot, 'approval', inspection.reason);
      this.recordSignal(pot, 'approval_required', inspection.reason);
      
      if (this.shouldAutoApprove(pot, inspection) && this.config.monitoring.autoNudge && this.canNudge(pot.id, now)) {
        await this.nudgePot(pot.id);
        pot.inspectionReason = `${inspection.reason}; auto-approved (local agent)`;
      }
    }
    if (inspection.rateLimited) {
      this.recordAlert(pot, 'rate_limit', inspection.reason);
      this.recordSignal(pot, 'rate_limited', inspection.reason);
    }
    if (inspection.errorDetected) {
      this.recordAlert(pot, 'error', inspection.reason);
      this.recordSignal(pot, inspection.crashed ? 'session_missing' : 'error', inspection.reason);
    }
    if (inspection.compacted) {
      this.recordSignal(pot, 'compacted', inspection.milestone ? `rolling summary: ${inspection.milestone}` : 'conversation compacted');
    }

    let nextState = inspection.state;

    if (inspection.doneLikely && !inspection.doneCertain) {
      const smartDecision = await this.llm.analyzePot(
        pot,
        pot.lastOutput,
        'Decide whether this pot is truly done or only paused. Prefer "done" unless the task is clearly complete.',
      );
      if (smartDecision.action === 'done') {
        nextState = 'done';
        pot.inspectionReason = `${inspection.reason}; smart-decision: ${smartDecision.summary}`;
      } else if (smartDecision.action === 'pause') {
        nextState = 'idle';
        pot.inspectionReason = `${inspection.reason}; smart-decision: ${smartDecision.summary}`;
      } else if (smartDecision.action === 'needs_human') {
        nextState = 'waiting';
        pot.inspectionReason = `${inspection.reason}; smart-decision: ${smartDecision.summary}`;
      }
    }

    if (inspection.compactSuggested && this.config.monitoring.autoCompact && this.canCompact(pot.id, now)) {
      const compactThreshold = this.isFreeAgent(pot.agent) 
        ? Math.floor(this.config.monitoring.contextCompactThresholdPct * 0.75)
        : this.config.monitoring.contextCompactThresholdPct;
      
      if (pot.contextUsagePct !== undefined && pot.contextUsagePct >= compactThreshold) {
        await this.compactPot(pot.id);
        nextState = 'compacting';
      }
    }

    if (nextState === 'stuck' && this.config.monitoring.autoNudge && this.canNudge(pot.id, now)) {
      await this.nudgePot(pot.id);
      pot.inspectionReason = `${pot.inspectionReason}; auto-nudged`;
    }

    if ((inspection.crashed || nextState === 'error') && this.config.monitoring.autoRestart && this.canRestart(pot.id, now)) {
      await this.restartPot(pot.id, meta);
      nextState = 'restarting';
    }

    const previousState = pot.state;
    pot.state = nextState;
    meta.lastKnownState = nextState;

    if (previousState !== nextState) {
      const actionState = this.actionTimestamps.get(pot.id);
      if (nextState === 'done' && actionState?.lastWebhookState !== 'done') {
        this.touchAction(pot.id, { lastWebhookState: 'done' });
        await this.webhook.send('pot.complete', pot, { reason: pot.inspectionReason });
      } else if (nextState === 'stuck' && actionState?.lastWebhookState !== 'stuck') {
        this.touchAction(pot.id, { lastWebhookState: 'stuck' });
        await this.webhook.send('pot.stuck', pot, { reason: pot.inspectionReason });
      } else if (nextState === 'blocked' && actionState?.lastWebhookState !== 'blocked') {
        this.touchAction(pot.id, { lastWebhookState: 'blocked' });
        await this.webhook.send('pot.stuck', pot, { reason: pot.inspectionReason });
      } else if (nextState === 'error' && actionState?.lastWebhookState !== 'error') {
        this.touchAction(pot.id, { lastWebhookState: 'error' });
        await this.webhook.send('pot.error', pot, { reason: pot.inspectionReason });
      }
    }
  }

  private async restartPot(id: string, meta: PotRuntimeMetadata): Promise<void> {
    const pot = this.requirePot(id);
    if (this.tmux.hasSession(meta.session)) {
      this.tmux.killSession(meta.session);
    }
    this.tmux.createSession(meta.session, meta.repoPath, meta.command);
    pot.restarts += 1;
    pot.state = 'restarting';
    this.touchAction(id, { lastRestartAt: this.now() });

    const resumePrompt = meta.task
      ? `Resume this task after a restart: ${meta.task}\n\nCarry forward from this recent transcript:\n${pot.lastOutput.slice(-3000)}`
      : `Resume from the recent transcript:\n${pot.lastOutput.slice(-3000)}`;
    this.timeoutFn(() => {
      void this.sendPrompt(id, resumePrompt);
    }, 4000);
  }

  private async sendPrompt(id: string, prompt: string): Promise<void> {
    const pot = this.requirePot(id);
    this.tmux.sendKeys(pot.session, prompt, true);
    pot.lastSeenAt = this.now();
  }

  private safeCurrentPath(session: string): string {
    try {
      return this.tmux.currentPath(session);
    } catch {
      return process.cwd();
    }
  }

  private requirePot(id: string): PotStatus {
    const pot = this.pots.get(id);
    if (!pot) throw new Error(`Unknown pot: ${id}`);
    return pot;
  }

  private recordAlert(pot: PotStatus, type: PotStatus['alerts'][number]['type'], message: string): void {
    const last = pot.alerts[pot.alerts.length - 1];
    if (last && last.type === type && last.message === message) return;
    pot.alerts.push({ type, message, timestamp: this.now() });
    if (pot.alerts.length > 20) pot.alerts.shift();
  }

  private recordSignal(pot: PotStatus, kind: PotStatus['signals'][number]['kind'], message: string): void {
    const last = pot.signals[pot.signals.length - 1];
    if (last && last.kind === kind && last.message === message) return;
    pot.signals.push({ kind, message, timestamp: this.now() });
    if (pot.signals.length > 50) pot.signals.shift();
  }

  private canNudge(id: string, now: number): boolean {
    const last = this.actionTimestamps.get(id)?.lastNudgeAt ?? 0;
    if (now - last < 5 * 60 * 1000) return false;
    this.touchAction(id, { lastNudgeAt: now });
    return true;
  }

  private canCompact(id: string, now: number): boolean {
    const last = this.actionTimestamps.get(id)?.lastCompactAt ?? 0;
    if (now - last < 10 * 60 * 1000) return false;
    return true;
  }

  private canRestart(id: string, now: number): boolean {
    const last = this.actionTimestamps.get(id)?.lastRestartAt ?? 0;
    if (now - last < this.config.monitoring.restartBackoffMs) return false;
    return true;
  }

  private touchAction(id: string, patch: Partial<PotActionTimestamps>): void {
    this.actionTimestamps.set(id, {
      ...this.actionTimestamps.get(id),
      ...patch,
    });
  }

  private loadState(): void {
    if (!existsSync(this.stateFile)) return;
    const state = JSON.parse(readFileSync(this.stateFile, 'utf-8')) as PersistedDaemonState;
    for (const meta of state.pots ?? []) {
      this.metadata.set(meta.id, meta);
    }
  }

  private persistState(): void {
    const state: PersistedDaemonState = {
      pots: Array.from(this.metadata.values()),
    };
    writeFileSync(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  }
}

export function compactCommandForAgent(agent: string, rollingSummary?: boolean): string {
  if (agent === 'claude-code') return rollingSummary ? '/summarize' : '/compact';
  if (agent === 'codex') return rollingSummary ? '/summarize' : '/compact';
  if (agent === 'opencode') return rollingSummary ? '/summarize' : '/compact';
  if (agent === 'aider-local' || agent === 'aider-openrouter' || agent === 'aider') return '/clear';
  if (agent === 'goose') return rollingSummary ? '/summarize' : '/compact';
  if (agent === 'kiro') return rollingSummary ? '/summarize' : '/compact';
  if (agent === 'gemini-cli') return rollingSummary ? '/summarize' : '/clear';
  return rollingSummary ? '/summarize' : '/compact';
}
