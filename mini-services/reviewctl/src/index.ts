#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { exploreCommand } from './commands/explore.js';
import { planCommand } from './commands/plan.js';
import { runCommand } from './commands/run.js';
import { ingestCommand } from './commands/ingest.js';
import { verdictCommand } from './commands/verdict.js';
import { mergeCommand } from './commands/merge.js';
import { cleanupCommand } from './commands/cleanup.js';

const program = new Command();

program
  .name('reviewctl')
  .description('Code review orchestration CLI - Handoff Generator + Ingest mode')
  .version('1.0.0');

// Init command
program
  .command('init')
  .description('Initialize a new review run on review/* branch')
  .option('--create', 'Create review branch if it does not exist')
  .option('--branch <branch>', 'Specify branch name manually')
  .action(initCommand);

// Explore command group
program
  .command('explore <type>')
  .description('Run explorers: context or diff')
  .option('--force', 'Force re-run even if files exist')
  .action(exploreCommand);

// Plan command
program
  .command('plan')
  .description('Generate review plan based on exploration')
  .option('--level <level>', 'Review level: auto|quick|thorough|comprehensive', 'auto')
  .option('--type <type>', 'Review type: auto|python|sql|general|python+sql', 'auto')
  .option('--plan-path <path>', 'Explicit plan path to use as SSOT')
  .action(planCommand);

// Run command - generates handoff requests, NO SIMULATION
program
  .command('run')
  .description('Generate handoff requests for review agents (no simulation)')
  .option('--max-agents <n>', 'Maximum number of agents', '3')
  .option('--timeout <mins>', 'Timeout in minutes', '8')
  .option('--no-plan', 'Run without Plan (requires explicit flag)')
  .action(runCommand);

// Ingest command - accept pasted agent outputs
program
  .command('ingest')
  .description('Ingest agent or static analysis output')
  .option('--agent <name>', 'Agent name (code-reviewer, code-simplifier, etc.)')
  .option('--static <tool>', 'Static tool name (biome, ruff, pyrefly, pytest)')
  .option('--input <path>', 'Input file path (reads stdin if not specified)')
  .option('--extra', 'Allow agents/tools not in plan (stored but not counted)')
  .option('--overwrite', 'Overwrite existing report')
  .action(ingestCommand);

// Verdict command
program
  .command('verdict')
  .description('Generate final verdict from all agent reports')
  .option('--json', 'Output as JSON only')
  .option('--allow-incomplete', 'Generate verdict even with missing reports')
  .action(verdictCommand);

// Merge command
program
  .command('merge')
  .description('Merge current review branch after PASS verdict')
  .option('--squash', 'Use squash merge')
  .option('--force', 'Force merge even with warnings')
  .action(mergeCommand);

// Cleanup command
program
  .command('cleanup')
  .description('Clean up review run artifacts and branches')
  .option('--all', 'Clean all review runs, not just current')
  .option('--older-than <days>', 'Clean runs older than N days')
  .action(cleanupCommand);

// Error handling
program.exitOverride((err) => {
  if (err.code === 'commander.help' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

program.parse();
