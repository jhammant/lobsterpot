import { AgentConfig, DEFAULT_AGENTS, PotConfig } from './types.js';

export type SmartLlmProvider = 'openrouter' | 'ollama' | 'lmstudio';
export type ControlPlaneState =
  | 'starting'
  | 'running'
  | 'idle'
  | 'waiting'
  | 'blocked'
  | 'stuck'
  | 'error'
  | 'done'
  | 'rate_limited'
  | 'compacting'
  | 'restarting'
  | 'escalating'
  | 'killed';

export type WebhookEventType = 'pot.complete' | 'pot.error' | 'pot.stuck' | 'pot.milestone' | 'pot.escalated';

export interface SmartLlmConfig {
  provider: SmartLlmProvider;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface DaemonMonitoringConfig {
  checkIntervalMs: number;
  captureLines: number;
  idleThresholdMs: number;
  stuckThresholdMs: number;
  restartBackoffMs: number;
  contextCompactThresholdPct: number;
  autoNudge: boolean;
  autoCompact: boolean;
  autoRestart: boolean;
}

export interface DaemonWebhookConfig {
  url?: string;
  headers?: Record<string, string>;
  enabledEvents?: WebhookEventType[];
}

export interface LobsterPotDaemonConfig {
  port: number;
  stateDir: string;
  pidFile: string;
  llm: SmartLlmConfig;
  monitoring: DaemonMonitoringConfig;
  webhook: DaemonWebhookConfig;
  backend?: 'docker' | 'tmux';
  dockerImage?: string;
  routing?: {
    enabled: boolean;
    preferLocal: boolean;
    autoReview: boolean;
  };
  agents?: Record<string, AgentConfig>;
}

export interface PotRuntimeMetadata {
  id: string;
  session: string;
  repoPath: string;
  agent: string;
  command: string;
  task?: string;
  createdAt: number;
  lastKnownState?: ControlPlaneState;
}

export interface PotAlert {
  type: 'error' | 'stuck' | 'rate_limit' | 'approval' | 'context';
  message: string;
  timestamp: number;
}

export interface PotSignal {
  kind:
    | 'approval_required'
    | 'rate_limited'
    | 'error'
    | 'done'
    | 'milestone'
    | 'compacted'
    | 'context_high'
    | 'prompt_waiting'
    | 'idle'
    | 'session_missing'
    | 'blocked';
  message: string;
  timestamp: number;
}

export interface PotInspection {
  state: ControlPlaneState;
  reason: string;
  doneLikely: boolean;
  doneCertain: boolean;
  waitingForInput: boolean;
  approvalRequired: boolean;
  crashed: boolean;
  errorDetected: boolean;
  rateLimited: boolean;
  contextUsagePct?: number;
  compactSuggested: boolean;
  compacted: boolean;
  milestone?: string;
  rawMatches: string[];
  blocked?: boolean;
  stuck?: boolean;
}

export interface PotStatus {
  id: string;
  session: string;
  agent: string;
  repoPath: string;
  state: ControlPlaneState;
  task?: string;
  createdAt: number;
  lastSeenAt: number;
  lastChangeAt: number;
  lastOutput: string;
  contextUsagePct?: number;
  milestone?: string;
  alerts: PotAlert[];
  signals: PotSignal[];
  restarts: number;
  nudges: number;
  compactions: number;
  escalations?: number;
  escalatedFrom?: string;
  inspectionReason: string;
}

export interface CreateLocalPotRequest {
  id?: string;
  repoPath: string;
  agent: string;
  task: string;
  command?: string;
}

export interface SmartDecision {
  action: 'done' | 'continue' | 'needs_human' | 'pause';
  summary: string;
}

export interface SmartDecisionClient {
  analyzePot(pot: PotStatus, transcript: string, prompt: string): Promise<SmartDecision>;
}

export interface LocalTmuxBackend {
  listSessions(): string[];
  hasSession(session: string): boolean;
  capturePane(session: string, lines: number): string;
  currentPath(session: string): string;
  sendKeys(session: string, text: string, enter?: boolean): void;
  createSession(session: string, cwd: string, command: string): void;
  killSession(session: string): void;
}
export { DockerSessionBackend } from './docker-backend.js';

export interface WebhookClient {
  send(event: WebhookEventType, pot: PotStatus, details: Record<string, unknown>): Promise<void>;
}

export interface ControlPlaneDeps {
  tmux?: LocalTmuxBackend;
  llm?: SmartDecisionClient;
  webhook?: WebhookClient;
  now?: () => number;
  setInterval?: typeof global.setInterval;
  clearInterval?: typeof global.clearInterval;
  setTimeout?: typeof global.setTimeout;
}

export interface PersistedDaemonState {
  pots: PotRuntimeMetadata[];
}

export function resolveLocalAgent(agent: string, config: LobsterPotDaemonConfig): AgentConfig {
  return config.agents?.[agent] || DEFAULT_AGENTS[agent] || DEFAULT_AGENTS['opencode'];
}

export function toLocalPotConfig(request: CreateLocalPotRequest): PotConfig {
  return {
    name: request.id ?? request.agent,
    machine: 'localhost',
    repo: request.repoPath,
    agent: request.agent,
    task: request.task,
  };
}
