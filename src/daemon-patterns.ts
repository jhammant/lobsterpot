import { DaemonMonitoringConfig, PotInspection } from './daemon-types.js';

interface AgentPatterns {
  context: RegExp[];
  compacted: RegExp[];
  rateLimit: RegExp[];
  approval: RegExp[];
  error: RegExp[];
  done: RegExp[];
  milestone: RegExp[];
  promptWait: RegExp[];
}

const SHARED_ERROR_PATTERNS = [
  /\btraceback\b/i,
  /\bexception\b/i,
  /\bfatal\b/i,
  /\bpanic\b/i,
  /\bsegmentation fault\b/i,
  /\bout of memory\b/i,
  /\bno such file or directory\b/i,
];

const AGENT_PATTERNS: Record<string, AgentPatterns> = {
  'claude-code': {
    context: [/\bcontext[:\s]+(\d{1,3})%/i, /\b(\d{1,3})%\s+context\b/i],
    compacted: [/compacted conversation/i, /conversation compacted/i],
    rateLimit: [/rate limit/i, /too many requests/i, /retry after/i],
    approval: [/permission/i, /allow this action/i, /do you want to proceed/i],
    error: [/error:/i, /failed/i, ...SHARED_ERROR_PATTERNS],
    done: [/task complete/i, /completed successfully/i, /finished implementing/i],
    milestone: [/created .*file/i, /updated .*file/i, /tests? (pass|passed)/i, /commit/i],
    promptWait: [/❯\s*$/m, /press enter to continue/i],
  },
  codex: {
    context: [],
    compacted: [/compacted conversation/i, /summarized conversation/i],
    rateLimit: [/rate limit/i, /quota/i, /too many requests/i],
    approval: [/approval required/i, /allow command/i, /\[y\/n\]/i, /approve/i],
    error: [/error:/i, /failed/i, ...SHARED_ERROR_PATTERNS],
    done: [/all tasks complete/i, /work complete/i, /handoff ready/i],
    milestone: [/applied patch/i, /tests? (pass|passed)/i, /build succeeded/i],
    promptWait: [/❯\s*$/m, />\s*$/m],
  },
  aider: {
    context: [],
    compacted: [/cleared chat history/i, /chat history cleared/i],
    rateLimit: [/rate limit/i, /retrying in/i],
    approval: [/\(y\/n\)/i, /\[y\/n\]/i, /continue\?/i],
    error: [/traceback/i, /error/i, ...SHARED_ERROR_PATTERNS],
    done: [/all changes applied/i, /ok, i did that/i, /git commit/i],
    milestone: [/git commit/i, /tests? (pass|passed)/i, /wrote .*file/i],
    promptWait: [/>\s*$/m, /ask for help/i],
  },
  opencode: {
    context: [/\bcontext[:\s]+(\d{1,3})%/i, /\b(\d{1,3})%\s+context\b/i],
    compacted: [/compacted conversation/i, /summarized/i, /rolling summary/i],
    rateLimit: [/rate limit/i, /quota/i, /too many requests/i],
    approval: [/\[y\/n\]/i, /confirm/i, /approve/i],
    error: [/error:/i, /failed/i, ...SHARED_ERROR_PATTERNS],
    done: [/task complete/i, /completed/i, /finished/i],
    milestone: [/created .*file/i, /updated .*file/i, /tests? (pass|passed)/i],
    promptWait: [/>\s*$/m, /press enter/i],
  },
};

function agentPatterns(agent: string): AgentPatterns {
  if (agent === 'aider-local' || agent === 'aider-openrouter') return AGENT_PATTERNS.aider;
  if (agent === 'opencode') return AGENT_PATTERNS['opencode'];
  return AGENT_PATTERNS[agent] ?? AGENT_PATTERNS['claude-code'];
}

function extractContextUsage(output: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      const pct = Number.parseInt(match[1], 10);
      if (!Number.isNaN(pct)) return pct;
    }
  }
  return undefined;
}

function firstMatch(output: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

export interface AnalyzeTranscriptInput {
  agent: string;
  output: string;
  changed: boolean;
  idleMs: number;
  monitoring: DaemonMonitoringConfig;
  sessionMissing?: boolean;
}

export function analyzeTranscript(input: AnalyzeTranscriptInput): PotInspection {
  const patterns = agentPatterns(input.agent);
  const rawMatches: string[] = [];

  const contextUsagePct = extractContextUsage(input.output, patterns.context);
  const compacted = Boolean(firstMatch(input.output, patterns.compacted));
  if (compacted) rawMatches.push('compacted');

  const rateLimitMatch = firstMatch(input.output, patterns.rateLimit);
  if (rateLimitMatch) rawMatches.push(rateLimitMatch);

  const approvalMatch = firstMatch(input.output, patterns.approval);
  if (approvalMatch) rawMatches.push(approvalMatch);

  const errorMatch = firstMatch(input.output, patterns.error);
  if (errorMatch) rawMatches.push(errorMatch);

  const doneMatch = firstMatch(input.output, patterns.done);
  if (doneMatch) rawMatches.push(doneMatch);

  const milestoneMatch = firstMatch(input.output, patterns.milestone);
  if (milestoneMatch) rawMatches.push(milestoneMatch);

  const promptWait = Boolean(firstMatch(input.output, patterns.promptWait));

  if (input.sessionMissing) {
    return {
      state: 'error',
      reason: 'tmux session missing',
      doneLikely: false,
      doneCertain: false,
      waitingForInput: false,
      approvalRequired: false,
      crashed: true,
      errorDetected: true,
      rateLimited: false,
      compactSuggested: false,
      compacted: false,
      rawMatches: ['session missing'],
    };
  }

  const compactSuggested = Boolean(
    contextUsagePct !== undefined &&
      contextUsagePct >= input.monitoring.contextCompactThresholdPct &&
      !compacted,
  );

  if (rateLimitMatch) {
    return {
      state: 'rate_limited',
      reason: `rate limited: ${rateLimitMatch}`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: true,
      approvalRequired: false,
      crashed: false,
      errorDetected: false,
      rateLimited: true,
      contextUsagePct,
      compactSuggested,
      compacted,
      rawMatches,
    };
  }

  if (errorMatch) {
    return {
      state: 'error',
      reason: `error detected: ${errorMatch}`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: false,
      approvalRequired: false,
      crashed: true,
      errorDetected: true,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      rawMatches,
    };
  }

  if (approvalMatch) {
    return {
      state: 'waiting',
      reason: `approval needed: ${approvalMatch}`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: true,
      approvalRequired: true,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
    };
  }

  if (doneMatch && promptWait) {
    return {
      state: 'done',
      reason: `completion detected: ${doneMatch}`,
      doneLikely: true,
      doneCertain: true,
      waitingForInput: false,
      approvalRequired: false,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
    };
  }

  if (doneMatch) {
    return {
      state: 'idle',
      reason: `possible completion: ${doneMatch}`,
      doneLikely: true,
      doneCertain: false,
      waitingForInput: false,
      approvalRequired: false,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
    };
  }

  const isBlocked = promptWait && input.idleMs >= input.monitoring.stuckThresholdMs / 2;

  if (isBlocked) {
    return {
      state: 'blocked',
      reason: `waiting for input for ${Math.round(input.idleMs / 1000)}s (blocked state)`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: true,
      approvalRequired: approvalMatch !== undefined || promptWait,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
      blocked: true,
    };
  }

  if (!input.changed && input.idleMs >= input.monitoring.stuckThresholdMs) {
    return {
      state: 'stuck',
      reason: `no output change for ${Math.round(input.idleMs / 1000)}s`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: promptWait,
      approvalRequired: false,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
    };
  }

  if (!input.changed && input.idleMs >= input.monitoring.idleThresholdMs) {
    return {
      state: promptWait ? 'waiting' : 'idle',
      reason: `idle for ${Math.round(input.idleMs / 1000)}s`,
      doneLikely: false,
      doneCertain: false,
      waitingForInput: promptWait,
      approvalRequired: false,
      crashed: false,
      errorDetected: false,
      rateLimited: false,
      contextUsagePct,
      compactSuggested,
      compacted,
      milestone: milestoneMatch,
      rawMatches,
    };
  }

  return {
    state: compactSuggested ? 'compacting' : 'running',
    reason: compactSuggested ? 'context threshold exceeded' : 'output active',
    doneLikely: false,
    doneCertain: false,
    waitingForInput: false,
    approvalRequired: false,
    crashed: false,
    errorDetected: false,
    rateLimited: false,
    contextUsagePct,
    compactSuggested,
    compacted,
    milestone: milestoneMatch,
    rawMatches,
  };
}
