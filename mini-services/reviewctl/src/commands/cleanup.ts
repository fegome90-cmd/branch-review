import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { REVIEW_RUNS_DIR } from '../lib/constants.js';
import { getBaseBranch, getCurrentRun } from '../lib/utils.js';

export async function cleanupCommand(options: {
  all?: boolean;
  olderThan?: string;
}) {
  const spinner = ora('Cleaning up...').start();

  try {
    const run = getCurrentRun();

    if (options.all) {
      // Clean all review runs
      spinner.text = 'Cleaning all review runs...';

      if (fs.existsSync(REVIEW_RUNS_DIR)) {
        const runs = fs.readdirSync(REVIEW_RUNS_DIR);
        let cleaned = 0;

        for (const runId of runs) {
          const runPath = path.join(REVIEW_RUNS_DIR, runId);
          const stat = fs.statSync(runPath);

          if (stat.isDirectory()) {
            // Check if merged
            const finalJsonPath = path.join(runPath, 'final.json');
            if (fs.existsSync(finalJsonPath)) {
              const _finalJson = JSON.parse(
                fs.readFileSync(finalJsonPath, 'utf-8'),
              );
              // Only clean merged/completed runs
              fs.rmSync(runPath, { recursive: true });
              cleaned++;
            }
          }
        }

        spinner.succeed(chalk.green(`Cleaned ${cleaned} review runs`));
      } else {
        spinner.succeed('No review runs to clean');
      }
    } else if (options.olderThan) {
      // Clean runs older than N days
      const days = parseInt(options.olderThan, 10);
      if (Number.isNaN(days) || days < 1) {
        spinner.fail('Invalid --older-than value. Must be a positive number.');
        process.exit(1);
      }

      spinner.text = `Cleaning runs older than ${days} days...`;

      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      let cleaned = 0;

      if (fs.existsSync(REVIEW_RUNS_DIR)) {
        const runs = fs.readdirSync(REVIEW_RUNS_DIR);

        for (const runId of runs) {
          const runPath = path.join(REVIEW_RUNS_DIR, runId);
          const stat = fs.statSync(runPath);

          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            fs.rmSync(runPath, { recursive: true });
            cleaned++;
          }
        }
      }

      spinner.succeed(chalk.green(`Cleaned ${cleaned} old review runs`));
    } else if (run) {
      // Clean current run
      spinner.text = 'Cleaning current review run...';

      // Check if merged (branch should not exist or be merged)
      const branch = run.branch;
      let canDelete = false;

      try {
        // Check if branch is merged
        const baseBranch = run.base_branch || getBaseBranch();
        const mergedBranches = execSync(`git branch --merged ${baseBranch}`, {
          encoding: 'utf-8',
        });
        canDelete =
          mergedBranches.includes(branch) || !branch.startsWith('review/');
      } catch {
        // If we can't check, assume it's OK if verdict was PASS
        const runDir = path.join(REVIEW_RUNS_DIR, run.run_id);
        const finalJsonPath = path.join(runDir, 'final.json');
        if (fs.existsSync(finalJsonPath)) {
          const finalJson = JSON.parse(fs.readFileSync(finalJsonPath, 'utf-8'));
          canDelete = finalJson.verdict === 'PASS';
        }
      }

      if (canDelete) {
        // Delete local review branch
        try {
          if (branch.startsWith('review/')) {
            execSync(`git branch -D ${branch} 2>/dev/null || true`, {
              stdio: 'pipe',
            });
          }
        } catch {
          // Branch may not exist locally
        }

        // Delete remote review branch
        try {
          if (branch.startsWith('review/')) {
            execSync(`git push origin --delete ${branch} 2>/dev/null || true`, {
              stdio: 'pipe',
            });
          }
        } catch {
          // Branch may not exist remotely
        }

        // Clean tmux sessions (if any)
        try {
          const sessions = execSync('tmux list-sessions 2>/dev/null || true', {
            encoding: 'utf-8',
          });
          const reviewSessions = sessions
            .split('\n')
            .filter((s) => s.includes(run.run_id))
            .map((s) => s.split(':')[0]);

          for (const session of reviewSessions) {
            execSync(`tmux kill-session -t ${session} 2>/dev/null || true`);
          }
        } catch {
          // tmux not available or no sessions
        }

        // Remove current.json
        const currentJsonPath = path.join(REVIEW_RUNS_DIR, 'current.json');
        if (fs.existsSync(currentJsonPath)) {
          fs.unlinkSync(currentJsonPath);
        }

        spinner.succeed(chalk.green('Cleanup completed'));
        console.log(chalk.gray(`  Branch ${branch} deleted (if existed)`));
        console.log(chalk.gray(`  Run ${run.run_id} archived`));
      } else {
        spinner.warn(
          chalk.yellow('Branch not merged. Use --force to clean anyway.'),
        );
        console.log(
          chalk.gray(
            `  Switch to base branch and merge first: git checkout ${run.base_branch}`,
          ),
        );
      }
    } else {
      spinner.succeed('No active run to clean');
    }
  } catch (error) {
    spinner.fail(chalk.red('Cleanup failed'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
