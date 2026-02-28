import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { PlanStatus, RunMetadata, RunStatus } from '../lib/constants.js';
import { resolvePlan } from '../lib/plan-resolver.js';
import {
  ensureDir,
  buildReviewBranchName,
  generateRunId,
  getBaseBranch,
  getCurrentBranch,
  getRunDir,
  getShaForRef,
  isOnReviewBranch,
  isValidGitRef,
  saveCurrentRun,
} from '../lib/utils.js';

/**
 * Initialize a new review run.
 *
 * Creates a review branch, records base/target branch metadata,
 * generates a run ID, and prepares the run directory structure.
 *
 * **Branch creation**:
 * - Creates review branch from `targetBranch` if `--create` is used
 * - Branch format: `review/<base>--<target>--<sha>`
 *
 * **Deprecation warning**: `--branch` is deprecated, use `--target` instead.
 *
 * @param options - Initialization options
 * @param options.create - Create a new review branch
 * @param options.branch - Deprecated: use `--target` instead
 * @param options.base - Base branch for comparison (defaults to main/master)
 * @param options.target - Target branch to review (defaults to current branch)
 *
 * @throws {Error} If base or target branch cannot be resolved
 *
 * @example
 * ```bash
 * reviewctl init --base main --target dev --create
 * ```
 */
export async function initCommand(options: {
  create?: boolean;
  branch?: string;
  base?: string;
  target?: string;
}) {
  const spinner = ora('Initializing review run...').start();

  try {
    if (options.branch) {
      console.log(
        chalk.yellow(
          'Warning: --branch is deprecated and will be removed in 2 releases. Use --target/--base.',
        ),
      );
    }

    const currentBranch = getCurrentBranch();
    const baseBranch = options.base || getBaseBranch();
    const targetBranch = options.target || options.branch || currentBranch;

    // Security: Validate git refs before use
    if (!isValidGitRef(targetBranch)) {
      throw new Error(`Invalid target branch/ref: ${targetBranch}`);
    }
    if (!isValidGitRef(baseBranch)) {
      throw new Error(`Invalid base branch/ref: ${baseBranch}`);
    }

    const targetSha = getShaForRef(targetBranch);
    const baseSha = getShaForRef(baseBranch);

    if (targetSha === 'unknown') {
      throw new Error(`Target branch/ref not found: ${targetBranch}`);
    }

    if (baseSha === 'unknown') {
      throw new Error(`Base branch/ref not found: ${baseBranch}`);
    }

    let branch = currentBranch;

    // Check if on review branch or create one
    if (!isOnReviewBranch()) {
      if (options.create) {
        const newBranch = buildReviewBranchName(baseBranch, targetBranch, targetSha);
        spinner.text = `Creating review branch: ${newBranch}`;

        try {
          execFileSync('git', ['checkout', '-b', newBranch, targetBranch], { stdio: 'inherit' });
          branch = newBranch;
        } catch (error) {
          spinner.fail('Failed to create review branch');
          throw error;
        }
      } else {
        spinner.fail(
          chalk.yellow('Not on a review/* branch. Use --create to create one.'),
        );
        console.log(chalk.gray(`  Example: reviewctl init --create --target ${targetBranch}`));
        process.exit(1);
      }
    }

    // Generate run ID
    const runId = generateRunId();
    const runDir = getRunDir(runId);
    ensureDir(runDir);

    // Resolve plan
    spinner.text = 'Resolving Plan SSOT...';
    const planResult = await resolvePlan();

    // Create run metadata
    const run: RunMetadata = {
      run_id: runId,
      branch,
      base_branch: baseBranch,
      target_branch: targetBranch,
      base_sha: baseSha,
      target_sha: targetSha,
      created_at: new Date().toISOString(),
      status: 'pending' as RunStatus,
      plan_status: planResult.status as PlanStatus,
      plan_path: planResult.path || undefined,
      drift_override_used: false,
      warnings_total: 0,
    };

    // Save run metadata
    saveCurrentRun(run);

    // Save initial run file
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify(run, null, 2),
    );

    // Create subdirectories
    ensureDir(path.join(runDir, 'reports'));
    ensureDir(path.join(runDir, 'tasks'));
    ensureDir(path.join(runDir, 'statics'));
    ensureDir(path.join(runDir, 'explore'));
    ensureDir(path.join(runDir, 'templates'));
    ensureDir(path.join(runDir, 'handoffs'));

    // Handle plan resolution
    if (planResult.status === 'FOUND') {
      spinner.succeed(chalk.green(`Review run initialized: ${runId}`));
      console.log(chalk.gray(`  Review Branch: ${branch}`));
      console.log(chalk.gray(`  Base Branch: ${baseBranch} (${baseSha})`));
      console.log(chalk.gray(`  Target Branch: ${targetBranch} (${targetSha})`));
      console.log(chalk.gray(`  Plan: ${planResult.path}`));
    } else if (planResult.status === 'AMBIGUOUS') {
      spinner.warn(chalk.yellow(`Review run initialized: ${runId}`));
      console.log(chalk.gray(`  Review Branch: ${branch}`));
      console.log(chalk.gray(`  Base Branch: ${baseBranch} (${baseSha})`));
      console.log(chalk.gray(`  Target Branch: ${targetBranch} (${targetSha})`));
      console.log(
        chalk.yellow('\n  Plan is AMBIGUOUS. Multiple candidates found:'),
      );
      if (planResult.candidates) {
        planResult.candidates.forEach((c, i) => {
          console.log(
            chalk.gray(`    ${i + 1}. ${c.path} (score: ${c.score})`),
          );
        });
      }
      console.log(
        chalk.gray('\n  Run: reviewctl plan --plan-path <path> to specify'),
      );
    } else {
      spinner.warn(chalk.yellow(`Review run initialized: ${runId}`));
      console.log(chalk.gray(`  Review Branch: ${branch}`));
      console.log(chalk.gray(`  Base Branch: ${baseBranch} (${baseSha})`));
      console.log(chalk.gray(`  Target Branch: ${targetBranch} (${targetSha})`));
      console.log(chalk.yellow('\n  Plan is MISSING. No matching plan found.'));
      console.log(
        chalk.gray('  Run: reviewctl plan --plan-path <path> to specify'),
      );
    }

    console.log(chalk.gray(`\n  Next: reviewctl explore context`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize review run'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
