import { execFileSync } from 'child_process';
import { LocalTmuxBackend, DockerSessionBackend as BackendType } from './daemon-types.js';

const DOCKER_PATH = process.env.DOCKER_PATH || 'docker';

function runDocker(args: string[]): string {
  try {
    return execFileSync(DOCKER_PATH, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DockerBackendError(message);
  }
}

function runDockerExec(container: string, args: string[]): string {
  const fullArgs = ['exec', container, ...args];
  try {
    return execFileSync(DOCKER_PATH, fullArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DockerBackendError(message);
  }
}

export class DockerBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerBackendError';
  }
}

export class DockerSessionBackend implements LocalTmuxBackend {
  constructor(private readonly containerName: string) {}

  listSessions(): string[] {
    try {
      const output = runDocker(['ps', '--filter', `name=${this.containerName}`, '--format', '{{.Names}}']);
      return output.split('\n').filter(Boolean);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DockerBackendError(`Failed to list docker containers: ${message}`);
    }
  }

  hasSession(session: string): boolean {
    try {
      const output = runDocker(['inspect', '--format', '{{.State.Running}}', session]);
      return output === 'true';
    } catch {
      return false;
    }
  }

  capturePane(session: string, lines: number): string {
    return runDockerExec(session, ['tmux', 'capture-pane', '-p', '-S', `-${lines}`, '-t', 'main']);
  }

  currentPath(session: string): string {
    return runDockerExec(session, ['tmux', 'display-message', '-p', '-t', 'main', '#{pane_current_path}']);
  }

  sendKeys(session: string, text: string, enter = true): void {
    const escapedText = text.replace(/'/g, "'\\''");
    const command = enter
      ? `tmux send-keys -t main -l -- '${escapedText}' && tmux send-keys -t main Enter`
      : `tmux send-keys -t main -l -- '${escapedText}'`;
    try {
      execFileSync(DOCKER_PATH, ['exec', session, '/bin/sh', '-lc', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DockerBackendError(message);
    }
  }

  createSession(session: string, cwd: string, command: string): void {
    // First ensure the container is running and tmux session exists
    runDocker(['exec', session, 'tmux', 'new-session', '-d', '-s', 'main', '-c', cwd, command]);
  }

  killSession(session: string): void {
    runDocker(['stop', session]);
    runDocker(['rm', session]);
  }
}
