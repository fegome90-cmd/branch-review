import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import {
  hasCommits,
  isWorkingTreeClean,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  type ValidationResult,
  validateBranchName,
  validateLengths,
  validateRequiredArgs,
} from '../lib/validation.js';

/**
 * Dependencies for prCommand - injectable for testing.
 */
export type PrCommandDeps = {
  execFileSync: (
    command: string,
    args: string[],
    options?: { encoding?: string; stdio?: (string | null)[] },
  ) => any;
  ora: typeof ora;
  consoleLog: (...args: unknown[]) => void;
  consoleError: (...args: unknown[]) => void;
  processExit: (code: number) => never;
};

/**
 * Default dependencies using real implementations.
 */
const defaultDeps: PrCommandDeps = {
  execFileSync: execFileSync,
  ora,
  consoleLog: console.log,
  consoleError: console.error,
  processExit: process.exit as PrCommandDeps['processExit'],
};

/**
 * Handles a validation result, exiting with error if invalid.
 */
function handleValidation(
  result: ValidationResult,
  spinner: ReturnType<typeof ora>,
  deps: PrCommandDeps,
): void {
  if (result.valid) return;

  spinner.fail(result.error);
  deps.consoleError(chalk.gray(`  Error code: ${result.code}`));
  deps.processExit(1);
}

/**
 * Creates a pull request for the current branch.
 *
 * @param options - PR options (title, body, base, draft)
 * @param deps - Injectable dependencies for testing
 */
export async function prCommand(
  options: {
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
  },
  deps: PrCommandDeps = defaultDeps,
): Promise<{ success: true; url: string } | { success: false; code: string }> {
  const spinner = deps.ora('Creating pull request...').start();

  // Validate required args
  const argsResult = validateRequiredArgs(options);
  if (!argsResult.valid) {
    spinner.fail(argsResult.error);
    deps.processExit(1);
  }

  // Validate lengths
  const lengthResult = validateLengths(options);
  if (!lengthResult.valid) {
    spinner.fail(lengthResult.error);
    deps.processExit(1);
  }

  // Check gh auth
  spinner.text = 'Checking gh authentication...';
  try {
    deps.execFileSync('gh', ['auth', 'status'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    spinner.fail(chalk.red('gh CLI not authenticated. Run: gh auth login'));
    deps.consoleError(chalk.gray('  Error code: GH_NOT_AUTHENTICATED'));
    deps.processExit(1);
  }

  // Check working tree is clean (including untracked files)
  spinner.text = 'Checking working tree...';
  try {
    const status = deps
      .execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      .trim();

    if (!isWorkingTreeClean(status)) {
      spinner.fail(chalk.red('Working tree has uncommitted changes'));
      deps.consoleError(chalk.gray('  Commit or stash changes first'));
      deps.consoleError(chalk.gray('  Error code: WORKING_TREE_DIRTY'));
      deps.processExit(1);
    }
  } catch {
    spinner.fail(chalk.red('Failed to check working tree'));
    deps.processExit(1);
  }

  // Get current branch
  const currentBranch = deps
    .execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8' })
    .trim();

  if (!currentBranch) {
    spinner.fail('Could not determine current branch');
    deps.processExit(1);
  }

  // Determine base branch
  const baseBranch = options.base || 'main';

  // Validate base branch name (security: prevent injection)
  const branchResult = validateBranchName(baseBranch);
  handleValidation(branchResult, spinner, deps);

  // Check for commits
  spinner.text = 'Checking for commits...';
  try {
    const commits = deps
      .execFileSync('git', ['log', `${baseBranch}..HEAD`, '--oneline'], {
        encoding: 'utf-8',
      })
      .trim();

    if (!hasCommits(commits)) {
      spinner.fail(
        chalk.red(`No commits between ${baseBranch} and ${currentBranch}`),
      );
      deps.consoleError(
        chalk.gray('  Make sure your branch has commits ahead of base'),
      );
      deps.consoleError(chalk.gray('  Error code: NO_COMMITS'));
      deps.processExit(1);
    }
  } catch {
    spinner.fail(chalk.red(`Failed to check commits against ${baseBranch}`));
    deps.processExit(1);
  }

  // Check if PR already exists
  spinner.text = 'Checking for existing PR...';
  let existingPrUrl: string | null = null;
  try {
    const viewOutput = deps.execFileSync(
      'gh',
      ['pr', 'view', '--json', 'url', '-q', '.url'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    existingPrUrl = viewOutput.trim() || null;
  } catch {
    // No existing PR, continue
  }

  if (existingPrUrl) {
    spinner.succeed(chalk.yellow('PR already exists'));
    deps.consoleLog(chalk.gray(`  URL: ${existingPrUrl}`));
    deps.consoleLog(chalk.gray('  Error code: PR_EXISTS'));
    deps.consoleLog(existingPrUrl);
    return { success: false, code: 'PR_EXISTS' };
  }

  // Create PR
  spinner.text = 'Creating pull request...';
  const args = [
    'pr',
    'create',
    '--title',
    options.title,
    '--body',
    options.body,
    '--base',
    baseBranch,
  ];

  if (options.draft) {
    args.push('--draft');
  }

  try {
    const prUrl = deps
      .execFileSync('gh', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      .trim();

    spinner.succeed(chalk.green('Pull request created'));
    deps.consoleLog(chalk.gray(`  Branch: ${currentBranch} → ${baseBranch}`));
    deps.consoleLog(chalk.gray(`  URL: ${prUrl}`));
    deps.consoleLog(prUrl);
    return { success: true, url: prUrl };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red('Failed to create PR'));
    deps.consoleError(chalk.gray(`  ${stderr}`));
    deps.consoleError(chalk.gray('  Error code: GH_CLI_ERROR'));
    deps.processExit(1);
  }
}

// Re-export for convenience
export { MAX_TITLE_LENGTH, MAX_BODY_LENGTH };
