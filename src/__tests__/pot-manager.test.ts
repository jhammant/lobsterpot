import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PotManager } from '../pot-manager.js';
import { LobsterPotConfig } from '../types.js';

// Mock child_process.execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

function makeConfig(overrides: Partial<LobsterPotConfig> = {}): LobsterPotConfig {
  return {
    machines: {
      'test-box': {
        host: '192.168.1.100',
        user: 'dev',
        key: '~/.ssh/id_ed25519',
      },
    },
    agents: {},
    monitoring: {
      checkIntervalMs: 30000,
      stuckThresholdS: 300,
      autoNudge: true,
      autoRecover: true,
    },
    ...overrides,
  };
}

describe('PotManager', () => {
  let manager: PotManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new PotManager(makeConfig());
  });

  describe('create', () => {
    it('creates a pot with correct initial state', async () => {
      const pot = await manager.create({
        name: 'test-pot',
        machine: 'test-box',
        repo: '/home/dev/project',
        agent: 'claude-code',
        task: 'write tests',
      });

      expect(pot.id).toBe('test-pot');
      expect(pot.state).toBe('loading');
      expect(pot.tmuxSession).toBe('lp-test-pot');
      expect(pot.config.agent).toBe('claude-code');
      expect(pot.milestones).toEqual([]);
      expect(pot.errors).toEqual([]);
    });

    it('executes SSH commands to check agent and start tmux session', async () => {
      await manager.create({
        name: 'ssh-test',
        machine: 'test-box',
        repo: '/home/dev/repo',
        agent: 'claude-code',
        task: 'build something',
      });

      expect(mockExecSync).toHaveBeenCalled();
      // First call is the agent availability check
      const whichCall = mockExecSync.mock.calls[0][0] as string;
      expect(whichCall).toContain('which claude');
      // Second call is the tmux session creation
      const tmuxCall = mockExecSync.mock.calls[1][0] as string;
      expect(tmuxCall).toContain('ssh');
      expect(tmuxCall).toContain('192.168.1.100');
      expect(tmuxCall).toContain('tmux new-session');
      expect(tmuxCall).toContain('lp-ssh-test');
    });

    it('throws on unknown machine', async () => {
      await expect(
        manager.create({
          name: 'bad',
          machine: 'nonexistent',
          repo: '/tmp',
          agent: 'claude-code',
          task: 'test',
        })
      ).rejects.toThrow('Unknown machine: nonexistent');
    });
  });

  describe('list', () => {
    it('returns empty array initially', () => {
      expect(manager.list()).toEqual([]);
    });

    it('returns created pots', async () => {
      await manager.create({
        name: 'pot-1',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'claude-code',
        task: 'task 1',
      });
      await manager.create({
        name: 'pot-2',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'aider-local',
        task: 'task 2',
      });

      const pots = manager.list();
      expect(pots).toHaveLength(2);
      expect(pots.map(p => p.id)).toEqual(['pot-1', 'pot-2']);
    });
  });

  describe('get', () => {
    it('returns undefined for unknown pot', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('returns the pot by id', async () => {
      await manager.create({
        name: 'find-me',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'claude-code',
        task: 'test',
      });

      const pot = manager.get('find-me');
      expect(pot).toBeDefined();
      expect(pot!.id).toBe('find-me');
    });
  });

  describe('capture', () => {
    it('throws for unknown pot', () => {
      expect(() => manager.capture('nonexistent')).toThrow('Unknown pot: nonexistent');
    });

    it('runs tmux capture-pane via SSH', async () => {
      await manager.create({
        name: 'cap-test',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'claude-code',
        task: 'test',
      });

      mockExecSync.mockReturnValueOnce('line1\nline2\nline3\n');
      const output = manager.capture('cap-test');
      expect(output).toContain('line');
    });
  });

  describe('send', () => {
    it('throws for unknown pot', () => {
      expect(() => manager.send('nonexistent', 'hello')).toThrow('Unknown pot: nonexistent');
    });

    it('sends via tmux send-keys', async () => {
      await manager.create({
        name: 'send-test',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'claude-code',
        task: 'test',
      });

      mockExecSync.mockClear();
      manager.send('send-test', 'hello world');

      expect(mockExecSync).toHaveBeenCalled();
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('tmux send-keys');
      expect(cmd).toContain('hello world');
    });
  });

  describe('kill', () => {
    it('throws for unknown pot', () => {
      expect(() => manager.kill('nonexistent')).toThrow('Unknown pot: nonexistent');
    });

    it('kills the tmux session and updates state', async () => {
      await manager.create({
        name: 'kill-test',
        machine: 'test-box',
        repo: '/tmp',
        agent: 'claude-code',
        task: 'test',
      });

      manager.kill('kill-test');
      const pot = manager.get('kill-test');
      expect(pot!.state).toBe('killed');
    });
  });
});
