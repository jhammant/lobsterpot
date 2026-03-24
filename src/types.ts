export type AgentType = 
  | 'claude-code'     // Anthropic — best for complex architecture
  | 'codex'           // OpenAI — broad coding tasks
  | 'kiro'            // Amazon (Bedrock) — spec-driven, generates docs+tests
  | 'gemini-cli'      // Google — research + analysis + coding
  | 'aider'           // Open source — works with any LLM backend
  | 'goose'           // Block/Square — open source, extensible
  | 'amp'             // Sourcegraph — codebase-aware
  | 'opencode'        // Open source CLI agent
  | 'custom';
export type CostTier = 'free' | 'low' | 'medium' | 'high';
export type PotState = 'creating' | 'loading' | 'running' | 'stuck' | 'error' | 'recovering' | 'done' | 'killed';

export interface MachineConfig {
  host: string;
  user: string;
  key?: string;
  defaultAgent?: AgentType;
  modelsDir?: string;
}

export interface AgentConfig {
  command: string;
  type: 'interactive-tui' | 'one-shot' | 'daemon';
  costTier: CostTier;
  stuckPatterns?: string[];    // Regex patterns that indicate waiting for input
  errorPatterns?: string[];    // Regex patterns that indicate errors
  promptPatterns?: string[];   // Regex patterns that indicate ready for input
}

export interface PotConfig {
  name: string;
  machine: string;
  repo: string;
  agent: string;
  task: string;
  channel?: string;            // Discord channel/thread for updates
  checkIntervalMs?: number;
  stuckThresholdS?: number;
  autoNudge?: boolean;
  autoRecover?: boolean;
  maxRetries?: number;
}

export interface Pot {
  id: string;
  config: PotConfig;
  state: PotState;
  tmuxSession: string;
  pid?: number;
  createdAt: number;
  lastActivity: number;
  lastOutput: string;
  tokensEstimate?: number;
  milestones: Milestone[];
  errors: PotError[];
}

export interface Milestone {
  timestamp: number;
  description: string;
  output?: string;
}

export interface PotError {
  timestamp: number;
  type: 'crash' | 'oom' | 'timeout' | 'stuck' | 'unknown';
  message: string;
  recovered: boolean;
}

export interface LobsterPotConfig {
  machines: Record<string, MachineConfig>;
  agents: Record<string, AgentConfig>;
  channels?: {
    discord?: {
      guildId: string;
      category: string;
    };
  };
  monitoring?: {
    checkIntervalMs: number;
    stuckThresholdS: number;
    autoNudge: boolean;
    autoRecover: boolean;
  };
}

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  // === PREMIUM (best quality, highest cost) ===
  'claude-code': {
    command: 'claude',
    type: 'interactive-tui',
    costTier: 'high',
    promptPatterns: ['❯\\s*$', '\\$\\s*$'],
    stuckPatterns: ['Yes.*No', 'proceed\\?', 'permission', 'y/n', 'Press.*to continue'],
    errorPatterns: ['Error:', 'FATAL', 'panic', 'Segmentation fault', 'killed', 'OOM'],
  },
  'codex': {
    command: 'codex',
    type: 'interactive-tui',
    costTier: 'medium',
    promptPatterns: ['❯\\s*$'],
    stuckPatterns: ['approve\\?', 'deny\\?'],
    errorPatterns: ['Error:', 'FATAL'],
  },
  'kiro': {
    command: 'kiro',
    type: 'interactive-tui',
    costTier: 'medium',
    promptPatterns: ['❯\\s*$', '\\$\\s*$'],
    stuckPatterns: ['confirm', 'proceed', 'y/n', 'approve'],
    errorPatterns: ['Error:', 'FATAL', 'exception'],
  },
  'gemini-cli': {
    command: 'gemini',
    type: 'interactive-tui',
    costTier: 'medium',
    promptPatterns: ['❯\\s*$'],
    stuckPatterns: [],
    errorPatterns: ['Error:', 'FATAL'],
  },

  // === FREE (open source + local models) ===
  'aider-local': {
    command: 'aider --model ollama/qwen2.5-coder:32b',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['>\\s*$'],
    stuckPatterns: ['y/n'],
    errorPatterns: ['Error', 'exception', 'Traceback'],
  },
  'aider-openrouter': {
    command: 'aider --model openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['>\\s*$'],
    stuckPatterns: ['y/n'],
    errorPatterns: ['Error', 'exception', 'Traceback'],
  },
  'goose': {
    command: 'goose',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['❯\\s*$', '>\\s*$'],
    stuckPatterns: ['y/n', 'approve', 'confirm'],
    errorPatterns: ['Error', 'panic', 'exception'],
  },
  'amp': {
    command: 'amp',
    type: 'interactive-tui',
    costTier: 'medium',
    promptPatterns: ['❯\\s*$'],
    stuckPatterns: ['approve', 'confirm'],
    errorPatterns: ['Error:', 'FATAL'],
  },
  'opencode': {
    command: 'opencode',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['>\\s*$'],
    stuckPatterns: ['y/n', 'confirm'],
    errorPatterns: ['Error', 'exception'],
  },
};
