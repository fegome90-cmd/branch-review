import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import {
  REVIEW_RUNS_DIR,
  RunMetadata,
  RunStatus,
  PlanStatus
} from '../lib/constants.js';
import {
  ensureDir,
  generateRunId,
  getCurrentBranch,
  getBaseBranch,
  getCurrentSha,
  isOnReviewBranch,
  saveCurrentRun,
  getRunDir
} from '../lib/utils.js';
import { resolvePlan } from '../lib/plan-resolver.js';

export async function initCommand(options: { create?: boolean; branch?: string }) {
  const spinner = ora('Initializing review run...').start();
  
  try {
    let branch = options.branch || getCurrentBranch();
    const baseBranch = getBaseBranch();
    const sha = getCurrentSha();
    
    // Check if on review branch or create one
    if (!isOnReviewBranch()) {
      if (options.create) {
        const newBranch = `review/${baseBranch}-${sha}`;
        spinner.text = `Creating review branch: ${newBranch}`;
        
        try {
          execSync(`git checkout -b ${newBranch}`, { stdio: 'inherit' });
          branch = newBranch;
        } catch (error) {
          spinner.fail('Failed to create review branch');
          throw error;
        }
      } else {
        spinner.fail(chalk.yellow('Not on a review/* branch. Use --create to create one.'));
        console.log(chalk.gray(`  Example: reviewctl init --create`));
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
      created_at: new Date().toISOString(),
      status: 'pending' as RunStatus,
      plan_status: planResult.status as PlanStatus,
      plan_path: planResult.path || undefined
    };
    
    // Save run metadata
    saveCurrentRun(run);
    
    // Save initial run file
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify(run, null, 2)
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
      console.log(chalk.gray(`  Branch: ${branch}`));
      console.log(chalk.gray(`  Plan: ${planResult.path}`));
    } else if (planResult.status === 'AMBIGUOUS') {
      spinner.warn(chalk.yellow(`Review run initialized: ${runId}`));
      console.log(chalk.gray(`  Branch: ${branch}`));
      console.log(chalk.yellow('\n  Plan is AMBIGUOUS. Multiple candidates found:'));
      if (planResult.candidates) {
        planResult.candidates.forEach((c, i) => {
          console.log(chalk.gray(`    ${i + 1}. ${c.path} (score: ${c.score})`));
        });
      }
      console.log(chalk.gray('\n  Run: reviewctl plan --plan-path <path> to specify'));
    } else {
      spinner.warn(chalk.yellow(`Review run initialized: ${runId}`));
      console.log(chalk.gray(`  Branch: ${branch}`));
      console.log(chalk.yellow('\n  Plan is MISSING. No matching plan found.'));
      console.log(chalk.gray('  Run: reviewctl plan --plan-path <path> to specify'));
    }
    
    console.log(chalk.gray(`\n  Next: reviewctl explore context`));
    
  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize review run'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
