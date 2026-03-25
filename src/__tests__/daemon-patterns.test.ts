import { describe, expect, it } from 'vitest';
import { analyzeTranscript } from '../daemon-patterns.js';
import { DEFAULT_DAEMON_CONFIG } from '../daemon-config.js';

describe('analyzeTranscript', () => {
  it('detects Claude context pressure and compaction need', () => {
    const result = analyzeTranscript({
      agent: 'claude-code',
      output: 'Status: 85% context\nThinking about next step',
      changed: true,
      idleMs: 1000,
      monitoring: DEFAULT_DAEMON_CONFIG.monitoring,
    });

    expect(result.contextUsagePct).toBe(85);
    expect(result.compactSuggested).toBe(true);
    expect(result.state).toBe('compacting');
  });

  it('detects Codex approval prompts', () => {
    const result = analyzeTranscript({
      agent: 'codex',
      output: 'Approval required. Allow command execution? [y/n]',
      changed: false,
      idleMs: 1000,
      monitoring: DEFAULT_DAEMON_CONFIG.monitoring,
    });

    expect(result.state).toBe('waiting');
    expect(result.approvalRequired).toBe(true);
  });

  it('detects Aider errors from tracebacks', () => {
    const result = analyzeTranscript({
      agent: 'aider-local',
      output: 'Traceback (most recent call last):\nValueError: boom',
      changed: true,
      idleMs: 1000,
      monitoring: DEFAULT_DAEMON_CONFIG.monitoring,
    });

    expect(result.state).toBe('error');
    expect(result.errorDetected).toBe(true);
  });

  it('marks unchanged output past the threshold as stuck', () => {
    const result = analyzeTranscript({
      agent: 'claude-code',
      output: 'Still thinking',
      changed: false,
      idleMs: DEFAULT_DAEMON_CONFIG.monitoring.stuckThresholdMs + 1000,
      monitoring: DEFAULT_DAEMON_CONFIG.monitoring,
    });

    expect(result.state).toBe('stuck');
  });
});
