import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { assertMergeEvidence, isSafeBranchName } from '../lib/merge-evidence.js';
import { loadPlanJson } from '../lib/plan-utils.js';
import { getCurrentRun, getRunDir } from '../lib/utils.js';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

function resolveCommit(ref: string): string {
  return git(['rev-parse', '--verify', `${ref}^{commit}`]);
}

function assertCleanWorktree(): void {
  if (git(['status', '--porcelain', '--untracked-files=normal']).length !== 0) {
    throw new Error('Cannot merge: working tree is not clean');
  }
}

export async function mergeCommand(options: {
  squash?: boolean;
  force?: boolean;
}) {
  const spinner = ora('Checking local merge evidence...').start();

  try {
    if (options.force) {
      throw new Error('Cannot merge: --force cannot bypass review evidence');
    }

    const run = getCurrentRun();
    if (!run) {
      throw new Error('Cannot merge: no active review run');
    }
    if (!isSafeBranchName(run.base_branch) || !isSafeBranchName(run.branch)) {
      throw new Error('Cannot merge: unsafe branch metadata');
    }
    // Validate names with Git itself before referring to the base branch.
    execFileSync('git', ['check-ref-format', '--branch', run.base_branch], {
      stdio: 'ignore',
    });
    execFileSync('git', ['check-ref-format', '--branch', run.branch], {
      stdio: 'ignore',
    });
    if (!/^run_[a-zA-Z0-9_-]+$/.test(run.run_id)) {
      throw new Error('Cannot merge: invalid run ID');
    }

    const finalPath = path.join(getRunDir(run.run_id), 'final.json');
    if (!fs.existsSync(finalPath)) {
      throw new Error('Cannot merge: final.json is missing');
    }
    const final: unknown = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
    const plan = loadPlanJson(getRunDir(run.run_id));
    if (!plan || !Array.isArray(plan.required_agents)) {
      throw new Error('Cannot merge: required reviewer plan is missing');
    }
    const current = {
      branch: git(['branch', '--show-current']),
      headSha: resolveCommit('HEAD'),
      baseSha: resolveCommit(`refs/heads/${run.base_branch}`),
    };

    assertMergeEvidence(run, final, current, plan.required_agents);
    assertCleanWorktree();

    // Never merge unrelated histories or a base that is not in the reviewed HEAD.
    try {
      execFileSync(
        'git',
        ['merge-base', '--is-ancestor', current.baseSha, current.headSha],
        { stdio: 'ignore' },
      );
    } catch (error: unknown) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
      if (status === 1) {
        throw new Error(
          'Cannot merge: reviewed base is not an ancestor of HEAD; rebase and re-run the review',
        );
      }
      throw error;
    }

    // Check immediately again before checkout. Merge the immutable reviewed
    // commit SHA (never a mutable branch ref).
    if (
      git(['branch', '--show-current']) !== current.branch ||
      resolveCommit('HEAD') !== current.headSha ||
      resolveCommit(`refs/heads/${run.base_branch}`) !== current.baseSha
    ) {
      throw new Error('Cannot merge: branch or commit changed during preflight');
    }
    assertCleanWorktree();

    spinner.text = `Merging reviewed commit into local ${run.base_branch}`;
    execFileSync('git', ['switch', run.base_branch], { stdio: 'inherit' });

    if (resolveCommit('HEAD') !== current.baseSha) {
      throw new Error('Cannot merge: base changed during checkout');
    }
    const message = `Merge review: ${run.branch}`;
    if (options.squash) {
      execFileSync('git', ['merge', '--squash', '--', current.headSha], {
        stdio: 'inherit',
      });
      execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' });
    } else {
      execFileSync(
        'git',
        ['merge', '--no-ff', '-m', message, '--', current.headSha],
        { stdio: 'inherit' },
      );
    }

    // No implicit push: local PASS is not approval for GitHub PR merge.
    spinner.succeed(chalk.green('Local merge completed'));
    console.log(chalk.gray(`  Reviewed HEAD: ${current.headSha}`));
    console.log(chalk.gray(`  Base: ${run.base_branch}`));
    console.log(chalk.yellow('  No push performed. Verify GitHub checks and approvals before publishing.'));
  } catch (error) {
    spinner.fail(chalk.red('Local merge blocked or failed'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }
}
