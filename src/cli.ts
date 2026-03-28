#!/usr/bin/env node
import { Command } from 'commander';
import { PotManager, SSHError, TmuxError, AgentError } from './pot-manager.js';
import { LobsterPotConfig } from './types.js';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { spawn } from 'child_process';
import { loadDaemonConfig, findDaemonConfigPath } from './daemon-config.js';
import { ControlPlaneDaemon } from './control-plane.js';
import { createControlPlaneApi } from './control-plane-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig(): LobsterPotConfig {
  const configPaths = [
    join(process.cwd(), 'lobsterpot.yaml'),
    join(homedir(), '.lobsterpot', 'config.yaml'),
    join(homedir(), '.config', 'lobsterpot', 'config.yaml'),
  ];

  for (const p of configPaths) {
    if (existsSync(p)) {
      return yaml.load(readFileSync(p, 'utf-8')) as LobsterPotConfig;
    }
  }

  // Default config
  return {
    machines: {},
    agents: {},
    monitoring: {
      checkIntervalMs: 30000,
      stuckThresholdS: 300,
      autoNudge: true,
      autoRecover: true,
    },
  };
}

function handleError(e: unknown): never {
  if (e instanceof SSHError) {
    console.error(`SSH error (${e.machine}): ${e.message}`);
  } else if (e instanceof TmuxError) {
    console.error(`tmux error: ${e.message}`);
  } else if (e instanceof AgentError) {
    console.error(`Agent error (${e.agent}): ${e.message}`);
  } else if (e instanceof Error) {
    console.error(`Error: ${e.message}`);
  } else {
    console.error('Unknown error', e);
  }
  process.exit(1);
}

const config = loadConfig();
const manager = new PotManager(config);

const program = new Command();

program
  .name('lobsterpot')
  .description('Remote coding agent orchestrator')
  .version('0.1.0');

program
  .command('create')
  .description('Create a new coding pot')
  .requiredOption('-n, --name <name>', 'Pot name')
  .requiredOption('-m, --machine <machine>', 'Target machine (from config)')
  .requiredOption('-r, --repo <repo>', 'Repository path on the machine')
  .option('-a, --agent <agent>', 'Agent to use', 'opencode')
  .requiredOption('-t, --task <task>', 'Task description')
  .option('--no-auto-nudge', 'Disable auto-nudge on stuck')
  .option('--no-auto-recover', 'Disable auto-recovery on crash')
  .action(async (opts) => {
    try {
      const pot = await manager.create({
        name: opts.name,
        machine: opts.machine,
        repo: opts.repo,
        agent: opts.agent,
        task: opts.task,
        autoNudge: opts.autoNudge,
        autoRecover: opts.autoRecover,
      });
      console.log(`🦞 Pot created: ${pot.id}`);
      console.log(`   Machine: ${pot.config.machine}`);
      console.log(`   Agent: ${pot.config.agent}`);
      console.log(`   tmux: ${pot.tmuxSession}`);
      console.log(`   State: ${pot.state}`);
    } catch (e) {
      handleError(e);
    }
  });

program
  .command('list')
  .description('List all active pots')
  .action(() => {
    const pots = manager.list();
    if (pots.length === 0) {
      console.log('No active pots');
      return;
    }
      console.log('🦞 Active pots:\n');
    for (const pot of pots) {
      const age = Math.round((Date.now() - pot.createdAt) / 60000);
      const errs = pot.errors.length;
      console.log(`  ${pot.id.padEnd(20)} ${pot.state.padEnd(12)} ${pot.config.agent.padEnd(15)} ${age}min  ${errs > 0 ? `⚠️ ${errs} errors` : '✅'}`);
    }
  });

program
  .command('status <pot>')
  .description('Get detailed status of a pot')
  .action((potId) => {
    const pot = manager.get(potId);
    if (!pot) {
      console.error(`Unknown pot: ${potId}`);
      process.exit(1);
    }
    const output = manager.capture(potId, 30);
    console.log(`🦞 Pot: ${pot.id}`);
    console.log(`   State: ${pot.state}`);
    console.log(`   Agent: ${pot.config.agent}`);
    console.log(`   Machine: ${pot.config.machine}`);
    console.log(`   Repo: ${pot.config.repo}`);
    console.log(`   Age: ${Math.round((Date.now() - pot.createdAt) / 60000)}min`);
    console.log(`   Milestones: ${pot.milestones.length}`);
    console.log(`   Errors: ${pot.errors.length}`);
    console.log(`\n--- Last output ---\n`);
    console.log(output);
  });

program
  .command('send <pot> <message>')
  .description('Send a message to a pot')
  .action((potId, message) => {
    manager.send(potId, message);
    console.log(`📨 Sent to ${potId}: ${message}`);
  });

program
  .command('capture <pot>')
  .description('Capture current output from a pot')
  .option('-l, --lines <lines>', 'Number of lines', '40')
  .action((potId, opts) => {
    const output = manager.capture(potId, parseInt(opts.lines));
    console.log(output);
  });

program
  .command('kill <pot>')
  .description('Kill a pot and its tmux session')
  .action((potId) => {
    manager.kill(potId);
    console.log(`💀 Killed pot: ${potId}`);
  });

program
  .command('serve')
  .description('Start the API server and dashboard')
  .option('-p, --port <port>', 'API port', '7450')
  .action(async (opts) => {
    const { createAPI } = await import('./api.js');
    const express = await import('express');
    const app = createAPI(manager, parseInt(opts.port));
    // Serve the dashboard at /dashboard
    const dashboardPath = join(__dirname, '..', 'dashboard');
    if (existsSync(dashboardPath)) {
      app.use('/dashboard', express.default.static(dashboardPath));
      console.log(`📊 Dashboard: http://127.0.0.1:${opts.port}/dashboard`);
    }
  });

program
  .command('route <task>')
  .description('Preview how a task would be routed (local-first smart routing)')
  .action(async (task) => {
    const { routeTask, classifyTask, planExecution } = await import('./router.js');
    const complexity = classifyTask(task);
    const decision = routeTask(task);
    const plan = planExecution(task);
    console.log(`🧠 Task complexity: ${complexity}`);
    console.log(`🔨 Build agent: ${decision.buildAgent}`);
    if (decision.reviewAgent) {
      console.log(`👀 Review agent: ${decision.reviewAgent}`);
    }
    console.log(`💰 Estimated cost: ${decision.estimatedCost}`);
    console.log(`💡 ${decision.reasoning}`);
    console.log();
    console.log(`📋 Phase 1: ${plan.phase1.agent} (${plan.phase1.estimatedTime})`);
    if (plan.phase2) {
      console.log(`📋 Phase 2: ${plan.phase2.agent} — review (${plan.phase2.estimatedTime})`);
    }
  });

const daemon = program.command('daemon').description('Manage the host-local LobsterPot control plane');

daemon
  .command('start')
  .description('Start the daemon in the background')
  .option('-c, --config <path>', 'Path to lobsterpot-daemon.yaml')
  .action(async (opts) => {
    try {
      const configPath = findDaemonConfigPath(opts.config);
      const daemonConfig = loadDaemonConfig(configPath);
      const pidFile = daemonConfig.pidFile;

      if (existsSync(pidFile)) {
        const existingPid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
        if (!Number.isNaN(existingPid)) {
          try {
            process.kill(existingPid, 0);
            console.log(`Daemon already running with PID ${existingPid}`);
            return;
          } catch {
            unlinkSync(pidFile);
          }
        }
      }

      const entryScript = fileURLToPath(import.meta.url);
      const child = spawn(
        process.execPath,
        [...process.execArgv, entryScript, 'daemon', 'run', ...(configPath ? ['--config', configPath] : [])],
        {
          detached: true,
          stdio: 'ignore',
        },
      );
      child.unref();
      console.log(`Daemon starting. PID file: ${pidFile}`);
    } catch (e) {
      handleError(e);
    }
  });

daemon
  .command('stop')
  .description('Stop the background daemon')
  .option('-c, --config <path>', 'Path to lobsterpot-daemon.yaml')
  .action((opts) => {
    try {
      const daemonConfig = loadDaemonConfig(findDaemonConfigPath(opts.config));
      if (!existsSync(daemonConfig.pidFile)) {
        console.log('Daemon is not running');
        return;
      }

      const pid = Number.parseInt(readFileSync(daemonConfig.pidFile, 'utf-8').trim(), 10);
      if (Number.isNaN(pid)) {
        unlinkSync(daemonConfig.pidFile);
        console.log('Removed stale PID file');
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
          unlinkSync(daemonConfig.pidFile);
          console.log('Removed stale PID file');
          return;
        }
        throw error;
      }

      console.log(`Stopped daemon process ${pid}`);
    } catch (e) {
      handleError(e);
    }
  });

daemon
  .command('run')
  .description('Run the daemon in the foreground')
  .option('-c, --config <path>', 'Path to lobsterpot-daemon.yaml')
  .action(async (opts) => {
    try {
      const configPath = findDaemonConfigPath(opts.config);
      const daemonConfig = loadDaemonConfig(configPath);
      writeFileSync(daemonConfig.pidFile, `${process.pid}\n`, 'utf-8');

      const controlPlane = new ControlPlaneDaemon(daemonConfig);
      controlPlane.start();
      const { server } = createControlPlaneApi(controlPlane, daemonConfig.port);

      const shutdown = () => {
        controlPlane.stop();
        if (!server) {
          if (existsSync(daemonConfig.pidFile)) unlinkSync(daemonConfig.pidFile);
          process.exit(0);
          return;
        }
        server.close(() => {
          if (existsSync(daemonConfig.pidFile)) unlinkSync(daemonConfig.pidFile);
          process.exit(0);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (e) {
      handleError(e);
    }
  });

program.parse();
