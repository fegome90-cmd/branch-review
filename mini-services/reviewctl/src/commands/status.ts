import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { loadPlanJson } from '../lib/plan-utils.js';
import {
  getCurrentRun,
  getLastRun,
  getRunById,
  getRunDir,
} from '../lib/utils.js';

interface StatusOptions {
  json?: boolean;
  runId?: string;
  last?: boolean;
}

/**
 * Display review run status and progress.
 *
 * Shows current run state, drift status, agent progress,
 * static analysis results, warnings, and verdict if available.
 *
 * **Output modes**:
 * - Human-readable (default): Colorized console output
 * - JSON (`--json`): Machine-readable JSON for API/automation
 *
 * **Run selection**:
 * - Default: Current active run
 * - `--run-id <id>`: Specific run by ID
 * - `--last`: Most recently completed run
 *
 * @param options - Status command options
 * @param options.json - Output as JSON instead of human-readable
 * @param options.runId - Specific run ID to check status for
 * @param options.last - Show status for most recent completed run
 *
 * @throws {Error} If no active run found (and no run-id/last specified)
 *
 * @example
 * ```bash
 * reviewctl status                    # Current run, human-readable
 * reviewctl status --json             # Current run, JSON output
 * reviewctl status --run-id run_20260227_abc  # Specific run
 * reviewctl status --last             # Most recent completed run
 * ```
 */
export async function statusCommand(options: StatusOptions) {
  const spinner = ora('Resolving review status...').start();

  try {
    const run = resolveRun(options);
    if (!run) {
      spinner.fail('No review run found. Run: reviewctl init');
      process.exit(1);
    }

    const runDir = getRunDir(run.run_id);
    const status = buildStatus(runDir, run);

    if (options.json) {
      spinner.stop();
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    spinner.succeed(chalk.green(`Status resolved: ${run.run_id}`));

    const targetBranch = run.target_branch || run.branch;
    console.log(chalk.gray(`  Run ID: ${run.run_id}`));
    console.log(chalk.gray(`  Base: ${run.base_branch}`));
    console.log(chalk.gray(`  Target: ${targetBranch}`));
    console.log(chalk.gray(`  Status: ${run.status}`));
    console.log(chalk.gray(`  Drift: ${status.drift.status}`));

    console.log(chalk.bold('\n  Progress'));
    console.log(
      chalk.gray(
        `  Explore: context=${status.explore.context ? 'OK' : 'MISSING'} diff=${status.explore.diff ? 'OK' : 'MISSING'}`,
      ),
    );
    console.log(
      chalk.gray(
        `  Plan: ${status.plan.present ? 'OK' : 'MISSING'} (${status.plan.path || 'N/A'})`,
      ),
    );
    console.log(
      chalk.gray(
        `  Agents: ${status.agents.completed}/${status.agents.total} complete`,
      ),
    );
    console.log(
      chalk.gray(
        `  Statics(required): ${status.statics.requiredPassed}/${status.statics.requiredTotal} passed`,
      ),
    );

    if (status.warnings.total > 0) {
      console.log(chalk.yellow(`  Warnings: ${status.warnings.total}`));
    }

    if (status.verdict.exists) {
      console.log(
        chalk.gray(`  Verdict: ${status.verdict.value || 'UNKNOWN'}`),
      );
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to resolve status'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

function resolveRun(options: StatusOptions): any | null {
  if (options.runId) {
    return getRunById(options.runId);
  }

  if (options.last) {
    return getLastRun();
  }

  return getCurrentRun();
}

function buildStatus(runDir: string, run: any) {
  const exploreDir = path.join(runDir, 'explore');
  const reportsDir = path.join(runDir, 'reports');
  const tasksDir = path.join(runDir, 'tasks');
  const staticsDir = path.join(runDir, 'statics');

  const contextExists = fs.existsSync(path.join(exploreDir, 'context.md'));
  const diffExists = fs.existsSync(path.join(exploreDir, 'diff.md'));
  const planPath = path.join(runDir, 'plan.md');
  const planExists = fs.existsSync(planPath);

  const planJson = loadPlanJson(runDir);
  const requiredAgents = planJson?.required_agents || [];

  let completedAgents = 0;
  for (const agent of requiredAgents) {
    const statusPath = path.join(tasksDir, agent, 'status.json');
    if (!fs.existsSync(statusPath)) continue;

    try {
      const statusJson = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      const status = String(statusJson.status || '').toUpperCase();
      if (
        (status === 'DONE' || status === 'PASS' || status === 'COMPLETED') &&
        statusJson.validation?.valid !== false
      ) {
        completedAgents++;
      }
    } catch {
      // ignore malformed status
    }
  }

  const requiredStatics = (planJson?.statics || []).filter((s) => s.required);
  let requiredPassed = 0;

  for (const tool of requiredStatics) {
    const statusPath = path.join(staticsDir, `${tool.name}_status.json`);
    if (!fs.existsSync(statusPath)) continue;

    try {
      const statusJson = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      const status = String(statusJson.status || '').toUpperCase();
      if (status === 'PASS' || status === 'DONE') {
        requiredPassed++;
      }
    } catch {
      // ignore malformed status
    }
  }

  const warningsTotal = countWarnings(tasksDir);

  const finalJsonPath = path.join(runDir, 'final.json');
  const verdictExists = fs.existsSync(finalJsonPath);
  let verdictValue: string | null = null;

  if (verdictExists) {
    try {
      const finalJson = JSON.parse(fs.readFileSync(finalJsonPath, 'utf-8'));
      verdictValue = finalJson.verdict || null;
    } catch {
      verdictValue = null;
    }
  }

  return {
    run_id: run.run_id,
    branch: run.branch,
    base_branch: run.base_branch,
    target_branch: run.target_branch || run.branch,
    explore: {
      context: contextExists,
      diff: diffExists,
    },
    plan: {
      present: planExists,
      path: run.plan_path || (planExists ? planPath : null),
    },
    agents: {
      completed: completedAgents,
      total: requiredAgents.length,
    },
    statics: {
      requiredPassed,
      requiredTotal: requiredStatics.length,
    },
    drift: {
      status: run.drift_status || 'UNKNOWN',
      override_used: Boolean(run.drift_override_used),
    },
    warnings: {
      total: warningsTotal,
    },
    verdict: {
      exists: verdictExists,
      value: verdictValue,
    },
    artifacts: {
      reports_dir: reportsDir,
      tasks_dir: tasksDir,
      statics_dir: staticsDir,
    },
  };
}

function countWarnings(tasksDir: string): number {
  if (!fs.existsSync(tasksDir)) {
    return 0;
  }

  let total = 0;

  for (const entry of fs.readdirSync(tasksDir)) {
    const statusPath = path.join(tasksDir, entry, 'status.json');
    if (!fs.existsSync(statusPath)) continue;

    try {
      const statusJson = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      const warnings = statusJson.validation?.warnings;
      if (Array.isArray(warnings)) {
        total += warnings.length;
      }
    } catch {
      // ignore malformed status
    }
  }

  return total;
}
