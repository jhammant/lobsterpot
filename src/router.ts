/**
 * LobsterPot Smart Router
 * 
 * Two-phase approach:
 *   Phase 1: Local/free model does the work (fast, zero cost)
 *   Phase 2: Expensive model reviews the output (quality gate)
 * 
 * This saves 80-90% on tokens while maintaining quality.
 */

export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'architecture';

export interface RoutingDecision {
  buildAgent: string;     // Who does the work
  reviewAgent?: string;   // Who checks it (optional)
  reasoning: string;
  estimatedCost: string;
}

export interface RouterConfig {
  localAvailable: boolean;        // Is Ollama running with a model?
  openrouterAvailable: boolean;   // Do we have OpenRouter free tier?
  claudeAvailable: boolean;       // Claude Code available?
  preferLocal: boolean;           // Default: true
  autoReview: boolean;            // Auto-trigger review phase? Default: true
  reviewThreshold: TaskComplexity; // Min complexity for review. Default: 'medium'
}

const DEFAULT_CONFIG: RouterConfig = {
  localAvailable: true,
  openrouterAvailable: true,
  claudeAvailable: true,
  preferLocal: true,
  autoReview: true,
  reviewThreshold: 'medium',
};

/**
 * Classify task complexity based on keywords and heuristics.
 */
export function classifyTask(task: string): TaskComplexity {
  const lower = task.toLowerCase();
  
  // Architecture-level signals
  const archPatterns = [
    'architect', 'design system', 'from scratch', 'full stack',
    'database schema', 'api design', 'microservices', 'migration',
    'security audit', 'performance architecture', 'scalab'
  ];
  if (archPatterns.some(p => lower.includes(p))) return 'architecture';
  
  // Complex signals
  const complexPatterns = [
    'refactor', 'optimis', 'debug complex', 'race condition',
    'memory leak', 'concurrent', 'distributed', 'crypto',
    'auth system', 'payment', 'real-time', 'streaming',
    'machine learning', 'inference', 'gpu', 'metal'
  ];
  if (complexPatterns.some(p => lower.includes(p))) return 'complex';
  
  // Simple signals  
  const simplePatterns = [
    'fix typo', 'rename', 'add comment', 'update readme',
    'bump version', 'add import', 'simple', 'quick',
    'change color', 'change text', 'add field', 'remove unused'
  ];
  if (simplePatterns.some(p => lower.includes(p))) return 'simple';
  
  // Default to medium
  return 'medium';
}

/**
 * Route a task to the right agent(s).
 * 
 * Strategy:
 *   simple  → local only, no review
 *   medium  → local build, optional review by OpenRouter/Claude
 *   complex → local or OpenRouter build, Claude review
 *   architecture → Claude build (too important for local)
 */
export function routeTask(task: string, config: Partial<RouterConfig> = {}): RoutingDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const complexity = classifyTask(task);
  
  switch (complexity) {
    case 'simple':
      return {
        buildAgent: cfg.localAvailable ? 'aider-local' : 'aider-openrouter',
        reasoning: `Simple task — local model handles this fine. No review needed.`,
        estimatedCost: '$0.00',
      };
      
    case 'medium':
      if (cfg.localAvailable) {
        return {
          buildAgent: 'aider-local',
          reviewAgent: cfg.autoReview ? 'claude-code' : undefined,
          reasoning: `Medium task — local model builds, Claude reviews for quality.`,
          estimatedCost: cfg.autoReview ? '~$0.05 (review only)' : '$0.00',
        };
      }
      return {
        buildAgent: 'aider-openrouter',
        reviewAgent: cfg.autoReview ? 'claude-code' : undefined,
        reasoning: `Medium task — OpenRouter free model builds, Claude reviews.`,
        estimatedCost: cfg.autoReview ? '~$0.05 (review only)' : '$0.00',
      };
      
    case 'complex':
      if (cfg.localAvailable) {
        return {
          buildAgent: 'aider-local',
          reviewAgent: 'claude-code',
          reasoning: `Complex task — local model takes first pass, Claude Code reviews and refines.`,
          estimatedCost: '~$0.10-0.30 (review + refinement)',
        };
      }
      return {
        buildAgent: cfg.openrouterAvailable ? 'aider-openrouter' : 'claude-code',
        reviewAgent: 'claude-code',
        reasoning: `Complex task — ${cfg.openrouterAvailable ? 'OpenRouter free' : 'Claude'} builds, Claude reviews.`,
        estimatedCost: cfg.openrouterAvailable ? '~$0.10-0.30' : '~$0.50-2.00',
      };
      
    case 'architecture':
      return {
        buildAgent: 'claude-code',
        reviewAgent: undefined,  // Claude IS the reviewer here
        reasoning: `Architecture-level task — needs Claude Code's full reasoning capability. Too important for local.`,
        estimatedCost: '~$1.00-5.00',
      };
  }
}

/**
 * Generate the review prompt for Phase 2.
 */
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

/**
 * Two-phase pot execution plan.
 */
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
  
  const plan: TwoPhasePlan = {
    phase1: {
      agent: decision.buildAgent,
      task: task,
      estimatedTime: decision.buildAgent.includes('local') ? '5-15min' : '3-10min',
    },
    totalEstimatedCost: decision.estimatedCost,
  };
  
  if (decision.reviewAgent) {
    plan.phase2 = {
      agent: decision.reviewAgent,
      task: buildReviewPrompt(task, '{{PHASE1_OUTPUT}}'),
      estimatedTime: '2-5min',
      triggerOn: 'completion',
    };
  }
  
  return plan;
}
