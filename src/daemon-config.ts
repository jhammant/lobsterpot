import { existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import yaml from 'js-yaml';
import { LobsterPotDaemonConfig } from './daemon-types.js';

export const DEFAULT_DAEMON_CONFIG: LobsterPotDaemonConfig = {
  port: 7555,
  stateDir: join(homedir(), '.lobsterpot'),
  pidFile: join(homedir(), '.lobsterpot', 'daemon.pid'),
  llm: {
    provider: 'lmstudio',
    model: 'local-model',
    baseUrl: 'http://127.0.0.1:1234/v1',
    enabled: false,
    timeoutMs: 15000,
  },
  monitoring: {
    checkIntervalMs: 45000,
    captureLines: 120,
    idleThresholdMs: 5 * 60 * 1000,
    stuckThresholdMs: 12 * 60 * 1000,
    restartBackoffMs: 30 * 1000,
    contextCompactThresholdPct: 80,
    autoNudge: true,
    autoCompact: true,
    autoRestart: true,
  },
  webhook: {
    enabledEvents: ['pot.complete', 'pot.error', 'pot.stuck', 'pot.milestone'],
  },
  agents: {},
};

export function daemonConfigSearchPaths(): string[] {
  return [
    join(process.cwd(), 'lobsterpot-daemon.yaml'),
    join(process.cwd(), 'lobsterpot-daemon.yml'),
    join(homedir(), '.lobsterpot', 'daemon.yaml'),
    join(homedir(), '.config', 'lobsterpot', 'daemon.yaml'),
  ];
}

export function findDaemonConfigPath(explicitPath?: string): string | undefined {
  const candidates = explicitPath ? [explicitPath] : daemonConfigSearchPaths();
  return candidates.find(p => existsSync(p));
}

export function loadDaemonConfig(explicitPath?: string): LobsterPotDaemonConfig {
  const configPath = findDaemonConfigPath(explicitPath);
  if (!configPath) {
    ensureDaemonDirectories(DEFAULT_DAEMON_CONFIG);
    return DEFAULT_DAEMON_CONFIG;
  }

  const parsed = (yaml.load(readFileSync(configPath, 'utf-8')) ?? {}) as Partial<LobsterPotDaemonConfig>;
  const merged: LobsterPotDaemonConfig = {
    ...DEFAULT_DAEMON_CONFIG,
    ...parsed,
    llm: {
      ...DEFAULT_DAEMON_CONFIG.llm,
      ...parsed.llm,
    },
    monitoring: {
      ...DEFAULT_DAEMON_CONFIG.monitoring,
      ...parsed.monitoring,
    },
    webhook: {
      ...DEFAULT_DAEMON_CONFIG.webhook,
      ...parsed.webhook,
    },
    agents: {
      ...DEFAULT_DAEMON_CONFIG.agents,
      ...parsed.agents,
    },
  };

  if (!parsed.stateDir && configPath) {
    merged.stateDir = join(dirname(resolve(configPath)), '.lobsterpot-daemon');
  }
  if (!parsed.pidFile) {
    merged.pidFile = join(merged.stateDir, 'daemon.pid');
  }

  ensureDaemonDirectories(merged);
  return merged;
}

export function ensureDaemonDirectories(config: LobsterPotDaemonConfig): void {
  mkdirSync(config.stateDir, { recursive: true });
}
