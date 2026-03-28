export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'architecture';
export type AgentRole = 'builder' | 'reviewer';

export interface RoutingDecision {
  buildAgent: string;
  reviewAgent?: string;
  reasoning: string;
  estimatedCost: string;
}

export interface RouterConfig {
  localAvailable: boolean;
  openrouterAvailable: boolean;
  opencodeAvailable: boolean;
  claudeAvailable: boolean;
  kiroAvailable: boolean;
  preferLocal: boolean;
  autoReview: boolean;
  reviewThreshold: TaskComplexity;
  reviewAgent: string;
  compactThresholdPct?: number;
  rollingSummary?: boolean;
}

const DEFAULT_CONFIG: RouterConfig = {
  localAvailable: true,
  openrouterAvailable: true,
  opencodeAvailable: true,
  claudeAvailable: true,
  kiroAvailable: false,
  preferLocal: true,
  autoReview: true,
  reviewThreshold: 'medium',
  reviewAgent: 'claude-code',
  compactThresholdPct: 50,
  rollingSummary: true,
};

export function classifyTask(task: string): TaskComplexity {
  const lower = task.toLowerCase();
  
  const archPatterns = [
    'architect', 'design system', 'from scratch', 'full stack',
    'database schema', 'api design', 'microservices', 'migration',
    'security audit', 'performance architecture', 'scalab'
  ];
  if (archPatterns.some(p => lower.includes(p))) return 'architecture';
  
  const complexPatterns = [
    'refactor', 'optimis', 'debug complex', 'race condition',
    'memory leak', 'concurrent', 'distributed', 'crypto',
    'auth system', 'payment', 'real-time', 'streaming',
    'machine learning', 'inference', 'gpu', 'metal'
  ];
  if (complexPatterns.some(p => lower.includes(p))) return 'complex';
  
  const simplepatterns = [
    'fix typo', 'rename', 'add comment', 'update readme',
    'bump version', 'add import', 'simple', 'quick',
    'change color', 'change text', 'add field', 'remove unused'
  ];
  if (simplepatterns.some(p => lower.includes(p))) return 'simple';
  
  return 'medium';
}

export function routeTask(task: string, config: Partial<RouterConfig> = {}): RoutingDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const complexity = classifyTask(task);
  
  const preferOpenCode = cfg.opencodeAvailable && (cfg.preferLocal || complexity !== 'architecture');
  
  if (!cfg.autoReview) {
    return {
      buildAgent: preferOpenCode ? 'opencode' : (cfg.localAvailable ? 'aider-local' : 'claude-code'),
      reasoning: `Task with autoReview disabled. Will use ${preferOpenCode ? 'opencode' : (cfg.localAvailable ? 'local model' : 'Claude')}.`,
      estimatedCost: '$0.00',
    };
  }
  
  switch (complexity) {
    case 'simple':
      if (preferOpenCode) {
        return {
          buildAgent: 'opencode',
          reviewAgent: undefined,
          reasoning: `Simple task — OpenCode handles this fast and free (${cfg.rollingSummary ? 'with rolling summary' : 'compacted'}).`,
          estimatedCost: '$0.00',
        };
      }
      if (cfg.localAvailable) {
        return {
          buildAgent: 'aider-local',
          reviewAgent: undefined,
          reasoning: `Simple task — ${cfg.localAvailable ? 'local model' : 'OpenRouter free'} handles this. No review needed.`,
          estimatedCost: '$0.00',
        };
      }
      return {
        buildAgent: 'aider-openrouter',
        reasoning: `Simple task — OpenRouter free handles this. No review needed.`,
        estimatedCost: '$0.00',
      };
      
    case 'medium':
      if (preferOpenCode) {
        const reviewAgent = cfg.localAvailable ? 'aider-local' : 'claude-code';
        return {
          buildAgent: 'opencode',
          reviewAgent,
          reasoning: `Medium task — OpenCode builds quickly (${cfg.rollingSummary ? 'with rolling summary' : 'compacted'}), ${reviewAgent} reviews.`,
          estimatedCost: '~$0.05-0.10 (review only)',
        };
      }
      if (cfg.localAvailable) {
        return {
          buildAgent: 'aider-local',
          reviewAgent: 'claude-code',
          reasoning: `Medium task — local model builds, Claude reviews for quality.`,
          estimatedCost: '~$0.10 (review only)',
        };
      }
      if (cfg.openrouterAvailable) {
        return {
          buildAgent: 'aider-openrouter',
          reviewAgent: 'claude-code',
          reasoning: `Medium task — OpenRouter free builds, Claude reviews.`,
          estimatedCost: '~$0.10 (review only)',
        };
      }
      return {
        buildAgent: 'claude-code',
        reviewAgent: undefined,
        reasoning: `Medium task — Claude builds and reviews.`,
        estimatedCost: '~$0.50-2.00',
      };
      
    case 'complex':
      if (preferOpenCode) {
        return {
          buildAgent: 'opencode',
          reviewAgent: 'claude-code',
          reasoning: `Complex task — OpenCode does first pass free (${cfg.rollingSummary ? 'with rolling summary' : 'compacted'}), Claude reviews for quality.`,
          estimatedCost: '~$0.50-2.00 (review only)',
        };
      }
      if (cfg.localAvailable) {
        return {
          buildAgent: 'aider-local',
          reviewAgent: 'claude-code',
          reasoning: `Complex task — local model takes first pass, Claude Code reviews and refines.`,
          estimatedCost: '~$0.10-0.30 (review + refinement)',
        };
      }
      if (cfg.openrouterAvailable) {
        return {
          buildAgent: 'aider-openrouter',
          reviewAgent: 'claude-code',
          reasoning: `Complex task — OpenRouter free builds, Claude reviews.`,
          estimatedCost: '~$0.10-0.30',
        };
      }
      return {
        buildAgent: 'claude-code',
        reviewAgent: 'claude-code',
        reasoning: `Complex task — Claude builds and reviews (self-review when no free tier).`,
        estimatedCost: '~$0.50-2.00',
      };
      
    case 'architecture':
      return {
        buildAgent: 'claude-code',
        reviewAgent: undefined,
        reasoning: `Architecture-level task — needs Claude Code's full reasoning capability. Too important for local.`,
        estimatedCost: '~$1.00-5.00',
      };
  }
}

export function buildReviewPrompt(task: string, buildOutput: string): string {
  return `You are reviewing code changes made by a local AI coding model. 

ORIGINAL TASK: ${task}

The local model made the following changes. Review them for:
1. Correctness — does the code actually work?
2. Edge cases — are there bugs the local model missed?
3. Security — any vulnerabilities introduced?
4. Performance — any obvious inefficiencies?
5. Style — does it match the project conventions?

If changes are good, say "APPROVED" and note any minor suggestions.
If changes need fixes, make the fixes directly.

Focus on real issues, not nitpicks. The local model did the heavy lifting — you're the quality gate.`;
}

export interface TwoPhasePlan {
  phase1: {
    agent: string;
    task: string;
    estimatedTime: string;
  };
  phase2?: {
    agent: string;
    task: string;
    estimatedTime: string;
    triggerOn: 'completion' | 'manual';
  };
  totalEstimatedCost: string;
}

export function planExecution(task: string, config: Partial<RouterConfig> = {}): TwoPhasePlan {
  const decision = routeTask(task, config);
  const buildAgent = decision.buildAgent;
  
  const plan: TwoPhasePlan = {
    phase1: {
      agent: buildAgent,
      task: task,
      estimatedTime: getEstimatedTime(buildAgent, config.rollingSummary),
    },
    totalEstimatedCost: decision.estimatedCost,
  };
  
  if (decision.reviewAgent) {
    plan.phase2 = {
      agent: decision.reviewAgent,
      task: buildReviewPrompt(task, '{{PHASE1_OUTPUT}}'),
      estimatedTime: getEstimatedTime(decision.reviewAgent),
      triggerOn: 'completion',
    };
  }
  
  return plan;
}

function getEstimatedTime(agent: string, rollingSummary?: boolean): string {
  if (agent === 'opencode') return rollingSummary ? '2-5min' : '3-8min';
  if (agent.includes('local')) return '2-8min';
  if (agent.includes('openrouter')) return '3-10min';
  return '2-5min';
}

export function buildHandoffPrompt(task: string, previousContext: string, escalationReason: string): string {
  return `You are taking over a task from a previous AI coding agent that ${escalationReason}.

ORIGINAL TASK:
${task}

PREVIOUS AGENT'S LAST OUTPUT (for context):
${previousContext}

Continue from where the previous agent left off. Review what was done, fix any issues, and complete the task. 
Don't start over — build on what exists. Check git status and recent changes first.`;
}

export function getEscalationAgent(agent: string): string | null {
  // Escalation chain: opencode → claude-code
  if (agent === 'opencode') return 'claude-code';
  // Already at highest tier
  if (agent === 'claude-code') return null;
  // Other agents can also escalate to claude-code
  if (agent.includes('local') || agent.includes('aider')) return 'claude-code';
  // Unknown agents can't be escalated
  return null;
}
