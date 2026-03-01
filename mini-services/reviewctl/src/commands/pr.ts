import { execFileSync, execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 10000;

// Allowed characters for branch names (security validation)
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9_/.-]+$/;

function validateBranchName(branch: string): void {
  if (!BRANCH_NAME_REGEX.test(branch)) {
    console.error(chalk.red(`Invalid branch name: ${branch}`));
    console.error(
      chalk.gray(
        '  Only alphanumeric, underscore, slash, dot, and hyphen allowed',
      ),
    );
    console.error(chalk.gray('  Error code: INVALID_BRANCH_NAME'));
    process.exit(1);
  }
}

export async function prCommand(options: {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
}) {
  const spinner = ora('Creating pull request...').start();

  try {
    // Validate required args
    if (!options.title || !options.body) {
      spinner.fail(
        'Missing required arguments: --title and --body are required',
      );
      process.exit(1);
    }

    // Validate lengths
    if (options.title.length > MAX_TITLE_LENGTH) {
      spinner.fail(`Title too long (max ${MAX_TITLE_LENGTH} characters)`);
      process.exit(1);
    }

    if (options.body.length > MAX_BODY_LENGTH) {
      spinner.fail(`Body too long (max ${MAX_BODY_LENGTH} characters)`);
      process.exit(1);
    }

    // Check gh auth
    spinner.text = 'Checking gh authentication...';
    try {
      execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
    } catch {
      spinner.fail(chalk.red('gh CLI not authenticated. Run: gh auth login'));
      console.error(chalk.gray('  Error code: GH_NOT_AUTHENTICATED'));
      process.exit(1);
    }

    // Check working tree is clean (including untracked files)
    spinner.text = 'Checking working tree...';
    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (status) {
        spinner.fail(chalk.red('Working tree has uncommitted changes'));
        console.error(chalk.gray('  Commit or stash changes first'));
        console.error(chalk.gray('  Error code: WORKING_TREE_DIRTY'));
        process.exit(1);
      }
    } catch {
      spinner.fail(chalk.red('Failed to check working tree'));
      process.exit(1);
    }

    // Get current branch
    const currentBranch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
    }).trim();

    if (!currentBranch) {
      spinner.fail('Could not determine current branch');
      process.exit(1);
    }

    // Determine base branch
    const baseBranch = options.base || 'main';

    // Validate base branch name (security: prevent injection)
    validateBranchName(baseBranch);

    // Check for commits (safe: using execFileSync with arg array)
    spinner.text = 'Checking for commits...';
    try {
      const commits = execFileSync(
        'git',
        ['log', `${baseBranch}..HEAD`, '--oneline'],
        { encoding: 'utf-8' },
      ).trim();

      if (!commits) {
        spinner.fail(
          chalk.red(`No commits between ${baseBranch} and ${currentBranch}`),
        );
        console.error(
          chalk.gray('  Make sure your branch has commits ahead of base'),
        );
        console.error(chalk.gray('  Error code: NO_COMMITS'));
        process.exit(1);
      }
    } catch {
      spinner.fail(chalk.red(`Failed to check commits against ${baseBranch}`));
      process.exit(1);
    }

    // Check if PR already exists
    spinner.text = 'Checking for existing PR...';
    let existingPrUrl: string | null = null;
    try {
      existingPrUrl = execFileSync(
        'gh',
        ['pr', 'view', '--json', 'url', '-q', '.url'],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
    } catch {
      // No existing PR, continue
    }

    if (existingPrUrl) {
      spinner.succeed(chalk.yellow('PR already exists'));
      console.log(chalk.gray(`  URL: ${existingPrUrl}`));
      console.log(chalk.gray('  Error code: PR_EXISTS'));
      console.log(existingPrUrl);
      return;
    }

    // Create PR (safe: using execFileSync with arg array)
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
      const prUrl = execFileSync('gh', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      spinner.succeed(chalk.green('Pull request created'));
      console.log(chalk.gray(`  Branch: ${currentBranch} → ${baseBranch}`));
      console.log(chalk.gray(`  URL: ${prUrl}`));
      console.log(prUrl);
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      spinner.fail(chalk.red('Failed to create PR'));
      console.error(chalk.gray(`  ${stderr}`));
      console.error(chalk.gray('  Error code: GH_CLI_ERROR'));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red('Unexpected error'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
