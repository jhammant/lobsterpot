import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlPlaneDaemon } from '../control-plane.js';
import { createControlPlaneApi } from '../control-plane-api.js';
import {
  LocalTmuxBackend,
  LobsterPotDaemonConfig,
  PotStatus,
  SmartDecision,
  SmartDecisionClient,
  WebhookClient,
} from '../daemon-types.js';
import { DEFAULT_DAEMON_CONFIG } from '../daemon-config.js';

class FakeTmux implements LocalTmuxBackend {
  sessions = new Map<string, { cwd: string; output: string; sent: string[]; command: string }>();

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  hasSession(session: string): boolean {
    return this.sessions.has(session);
  }

  capturePane(session: string): string {
    const data = this.sessions.get(session);
    if (!data) throw new Error(`Missing session ${session}`);
    return data.output;
  }

  currentPath(session: string): string {
    return this.sessions.get(session)?.cwd ?? '/tmp';
  }

  sendKeys(session: string, text: string): void {
    const data = this.sessions.get(session);
    if (!data) throw new Error(`Missing session ${session}`);
    data.sent.push(text);
  }

  createSession(session: string, cwd: string, command: string): void {
    this.sessions.set(session, { cwd, output: '', sent: [], command });
  }

  killSession(session: string): void {
    this.sessions.delete(session);
  }
}

class FakeWebhook implements WebhookClient {
  events: Array<{ event: string; pot: string }> = [];

  async send(event: string, pot: PotStatus): Promise<void> {
    this.events.push({ event, pot: pot.id });
  }
}

class FakeLlm implements SmartDecisionClient {
  constructor(private readonly response: SmartDecision = { action: 'done', summary: 'clearly finished' }) {}

  async analyzePot(): Promise<SmartDecision> {
    return this.response;
  }
}

describe('ControlPlaneDaemon', () => {
  let stateDir: string;
  let config: LobsterPotDaemonConfig;
  let tmux: FakeTmux;
  let webhook: FakeWebhook;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'lobsterpot-daemon-'));
    config = {
      ...DEFAULT_DAEMON_CONFIG,
      stateDir,
      pidFile: join(stateDir, 'daemon.pid'),
      monitoring: {
        ...DEFAULT_DAEMON_CONFIG.monitoring,
        autoNudge: true,
        autoCompact: true,
        autoRestart: true,
      },
      llm: {
        ...DEFAULT_DAEMON_CONFIG.llm,
        enabled: true,
      },
    };
    tmux = new FakeTmux();
    webhook = new FakeWebhook();
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates a local pot and sends the task after the launch delay', async () => {
    const scheduled: Array<() => void> = [];
    const daemon = new ControlPlaneDaemon(config, {
      tmux,
      webhook,
      llm: new FakeLlm(),
      setTimeout: ((fn: () => void) => {
        scheduled.push(fn);
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof global.setTimeout,
    });

    const pot = await daemon.createPot({
      id: 'api-pot',
      repoPath: '/repo',
      agent: 'codex',
      task: 'Implement the endpoint',
    });

    expect(pot.session).toBe('lp-api-pot');
    expect(tmux.sessions.has('lp-api-pot')).toBe(true);

    scheduled.forEach(fn => fn());
    expect(tmux.sessions.get('lp-api-pot')?.sent).toContain('Implement the endpoint');
  });

  it('auto-compacts when Claude context exceeds the configured threshold', async () => {
    tmux.createSession('lp-compact-me', '/repo', 'claude');
    tmux.sessions.get('lp-compact-me')!.output = 'Status: 88% context\nStill working';

    const daemon = new ControlPlaneDaemon(config, {
      tmux,
      webhook,
      llm: new FakeLlm({ action: 'continue', summary: 'not done' }),
    });

    daemon.start();
    await daemon.pollOnce();

    expect(tmux.sessions.get('lp-compact-me')?.sent).toContain('/compact');
    expect(daemon.getPot('compact-me')?.state).toBe('compacting');
  });

  it('uses the cheap LLM only for ambiguous completion decisions', async () => {
    const daemon = new ControlPlaneDaemon(config, {
      tmux,
      webhook,
      llm: new FakeLlm({ action: 'done', summary: 'all requested changes are complete' }),
      setTimeout: ((fn: () => void) => {
        fn();
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof global.setTimeout,
    });
    await daemon.createPot({
      id: 'review-me',
      repoPath: '/repo',
      agent: 'codex',
      task: 'Finish the feature',
    });
    tmux.sessions.get('lp-review-me')!.output = 'Work complete.\n';

    daemon.start();
    await daemon.pollOnce();

    expect(daemon.getPot('review-me')?.state).toBe('done');
    expect(webhook.events.some(event => event.event === 'pot.complete')).toBe(true);
  });

  it('restarts a missing session when auto-restart is enabled', async () => {
    const scheduled: Array<() => void> = [];
    const daemon = new ControlPlaneDaemon(config, {
      tmux,
      webhook,
      llm: new FakeLlm({ action: 'continue', summary: 'resume work' }),
      setTimeout: ((fn: () => void) => {
        scheduled.push(fn);
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof global.setTimeout,
    });

    await daemon.createPot({
      id: 'restart-me',
      repoPath: '/repo',
      agent: 'codex',
      task: 'Fix the failing test',
    });
    tmux.killSession('lp-restart-me');

    await daemon.pollOnce();
    expect(daemon.getPot('restart-me')?.state).toBe('restarting');
    expect(tmux.sessions.has('lp-restart-me')).toBe(true);

    scheduled.forEach(fn => fn());
    expect(tmux.sessions.get('lp-restart-me')?.sent[0]).toContain('Fix the failing test');
  });
});

describe('createControlPlaneApi', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'lobsterpot-api-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('registers the requested daemon endpoints', async () => {
    const tmux = new FakeTmux();
    const config: LobsterPotDaemonConfig = {
      ...DEFAULT_DAEMON_CONFIG,
      stateDir,
      pidFile: join(stateDir, 'daemon.pid'),
    };
    const daemon = new ControlPlaneDaemon(config, {
      tmux,
      webhook: new FakeWebhook(),
      llm: new FakeLlm(),
      setTimeout: ((fn: () => void) => {
        fn();
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof global.setTimeout,
    });
    const { app, server } = createControlPlaneApi(daemon, 0, { listen: false });
    expect(server).toBeUndefined();

    const routes = ((app as unknown as { _router?: { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> } })._router?.stack ?? [])
      .filter(layer => layer.route?.path)
      .map(layer => ({
        path: layer.route?.path,
        methods: Object.keys(layer.route?.methods ?? {}).sort(),
      }));

    expect(routes).toEqual(
      expect.arrayContaining([
        { path: '/health', methods: ['get'] },
        { path: '/status', methods: ['get'] },
        { path: '/pot/:id', methods: ['get'] },
        { path: '/pot/:id/nudge', methods: ['post'] },
        { path: '/pot/:id/compact', methods: ['post'] },
        { path: '/pot/:id/kill', methods: ['post'] },
        { path: '/pot', methods: ['post'] },
      ]),
    );
  });
});
