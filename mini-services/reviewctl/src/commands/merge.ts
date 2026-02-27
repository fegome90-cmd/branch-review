import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  getCurrentRun,
  getRunDir,
  isOnReviewBranch,
  saveCurrentRun,
} from '../lib/utils.js';

export async function mergeCommand(options: {
  squash?: boolean;
  force?: boolean;
}) {
  const spinner = ora('Preparing merge...').start();

  try {
    // Check we're on a review branch
    if (!isOnReviewBranch()) {
      spinner.fail(
        'Not on a review/* branch. Switch to a review branch first.',
      );
      process.exit(1);
    }

    const run = getCurrentRun();
    if (!run) {
      spinner.fail('No active review run. Run: reviewctl init');
      process.exit(1);
    }

    // Check for final.json
    const runDir = getRunDir(run.run_id);
    const finalJsonPath = path.join(runDir, 'final.json');

    if (!fs.existsSync(finalJsonPath)) {
      spinner.fail('No verdict found. Run: reviewctl verdict');
      process.exit(1);
    }

    const finalJson = JSON.parse(fs.readFileSync(finalJsonPath, 'utf-8'));

    // Check verdict is PASS
    if (finalJson.verdict !== 'PASS' && !options.force) {
      spinner.fail(
        'Cannot merge: verdict is FAIL. Fix P0 issues first or use --force.',
      );
      process.exit(1);
    }

    spinner.text = 'Checking merge preconditions...';

    // Check working tree is clean
    try {
      execSync('git diff-index --quiet HEAD --', { stdio: 'pipe' });
    } catch {
      spinner.fail(
        'Working tree has uncommitted changes. Commit or stash first.',
      );
      process.exit(1);
    }

    // Check for PR (if gh is available)
    let prNumber: string | null = null;
    try {
      const prResult = execSync('gh pr view --json number,state 2>/dev/null', {
        encoding: 'utf-8',
      });
      const prData = JSON.parse(prResult);
      if (prData.state === 'OPEN') {
        prNumber = prData.number.toString();
        spinner.text = `Found PR #${prNumber}...`;
      }
    } catch {
      // No PR or gh not installed - that's OK
    }

    spinner.text = `Merging ${run.branch} into ${run.base_branch}...`;

    // Switch to base branch
    try {
      execSync(`git checkout ${run.base_branch}`, { stdio: 'inherit' });
    } catch (error) {
      spinner.fail('Failed to checkout base branch');
      throw error;
    }

    // Merge (squash or normal)
    try {
      if (options.squash) {
        execSync(`git merge --squash ${run.branch}`, { stdio: 'inherit' });
        execSync(`git commit -m "Merge review: ${run.branch}"`, {
          stdio: 'inherit',
        });
      } else {
        execSync(
          `git merge ${run.branch} --no-ff -m "Merge review: ${run.branch}"`,
          { stdio: 'inherit' },
        );
      }
    } catch (error) {
      spinner.fail('Merge failed. Resolve conflicts manually.');
      throw error;
    }

    // Push
    try {
      execSync('git push', { stdio: 'inherit' });
    } catch (_error) {
      spinner.warn('Failed to push. Push manually when ready.');
    }

    // Update run status
    run.status = 'completed';
    saveCurrentRun(run);

    spinner.succeed(chalk.green('Merge completed successfully'));

    console.log(
      chalk.gray(`\n  Branch ${run.branch} merged into ${run.base_branch}`),
    );
    console.log(chalk.gray(`  Run: reviewctl cleanup`));
  } catch (error) {
    spinner.fail(chalk.red('Merge failed'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
