import { execFileSync } from 'child_process';
import { LocalTmuxBackend } from './daemon-types.js';

function runTmux(args: string[]): string {
  return execFileSync('tmux', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class TmuxBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmuxBackendError';
  }
}

export class LocalTmuxSessionBackend implements LocalTmuxBackend {
  listSessions(): string[] {
    try {
      const output = runTmux(['list-sessions', '-F', '#S']);
      return output.split('\n').filter(Boolean);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no server running')) return [];
      throw new TmuxBackendError(`Failed to list tmux sessions: ${message}`);
    }
  }

  hasSession(session: string): boolean {
    try {
      runTmux(['has-session', '-t', session]);
      return true;
    } catch {
      return false;
    }
  }

  capturePane(session: string, lines: number): string {
    return runTmux(['capture-pane', '-p', '-S', `-${lines}`, '-t', session]);
  }

  currentPath(session: string): string {
    return runTmux(['display-message', '-p', '-t', session, '#{pane_current_path}']);
  }

  sendKeys(session: string, text: string, enter = true): void {
    const command = enter
      ? `tmux send-keys -t ${escapeShellArg(session)} -l -- ${escapeShellArg(text)} && tmux send-keys -t ${escapeShellArg(session)} Enter`
      : `tmux send-keys -t ${escapeShellArg(session)} -l -- ${escapeShellArg(text)}`;
    execFileSync('/bin/sh', ['-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  createSession(session: string, cwd: string, command: string): void {
    runTmux(['new-session', '-d', '-s', session, '-c', cwd, command]);
  }

  killSession(session: string): void {
    runTmux(['kill-session', '-t', session]);
  }
}
