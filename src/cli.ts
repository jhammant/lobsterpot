#!/usr/bin/env node
import { Command } from 'commander';
import { PotManager } from './pot-manager.js';
import { LobsterPotConfig } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';

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

const config = loadConfig();
const manager = new PotManager(config);

const program = new Command();

program
  .name('lobsterpot')
  .description('🦞 Remote coding agent orchestrator')
  .version('0.1.0');

program
  .command('create')
  .description('Create a new coding pot')
  .requiredOption('-n, --name <name>', 'Pot name')
  .requiredOption('-m, --machine <machine>', 'Target machine (from config)')
  .requiredOption('-r, --repo <repo>', 'Repository path on the machine')
  .option('-a, --agent <agent>', 'Agent to use', 'claude-code')
  .requiredOption('-t, --task <task>', 'Task description')
  .option('--no-auto-nudge', 'Disable auto-nudge on stuck')
  .option('--no-auto-recover', 'Disable auto-recovery on crash')
  .action(async (opts) => {
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

program.parse();
