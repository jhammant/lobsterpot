export type AgentType = 
  | 'opencode'        // Open source CLI agent — DEFAULT first-choice for local tasks
  | 'claude-code'     // Anthropic — best for complex architecture
  | 'codex'           // OpenAI — broad coding tasks
  | 'kiro'            // Amazon (Bedrock) — spec-driven, generates docs+tests
  | 'gemini-cli'      // Google — research + analysis + coding
  | 'aider'           // Open source — works with any LLM backend
  | 'goose'           // Block/Square — open source, extensible
  | 'amp'             // Sourcegraph — codebase-aware
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
  contextUsagePct?: number;
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
  // === FREE (local/open source - FIRST CLASS) ===
  'opencode': {
    command: 'opencode',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['>\\s*$'],
    stuckPatterns: ['y/n', 'confirm', '\\[y/n\\]'],
    errorPatterns: ['Error', 'exception', 'Traceback'],
  },
  'opencode-local': {
    command: 'opencode --model ollama/qwen2.5-coder:32b',
    type: 'interactive-tui',
    costTier: 'free',
    promptPatterns: ['>\\s*$'],
    stuckPatterns: ['y/n', 'confirm', '\\[y/n\\]'],
    errorPatterns: ['Error', 'exception', 'Traceback'],
  },
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

  // === PAID (premium quality) ===
  'claude-code': {
    command: 'claude --dangerously-skip-permissions',
    type: 'interactive-tui',
    costTier: 'high',
    promptPatterns: ['❯\\s*$'],
    stuckPatterns: ['/compact', '/exit', 'y/n', 'confirm'],
    errorPatterns: ['Error:', 'FATAL', 'Traceback'],
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
  'amp': {
    command: 'amp',
    type: 'interactive-tui',
    costTier: 'medium',
    promptPatterns: ['❯\\s*$'],
    stuckPatterns: ['approve', 'confirm'],
    errorPatterns: ['Error:', 'FATAL'],
  },
};
