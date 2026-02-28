import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import {
  EXPLORE_DIR,
  PRECONDITION_ERRORS,
  REVIEW_RUNS_DIR,
  type RunMetadata,
} from './constants.js';

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dir - Directory path to create if it doesn't exist
 * @throws {Error} If directory cannot be created due to permissions
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a unique run ID based on current date and UUID.
 *
 * @returns Run ID in format `run_YYYYMMDD_{8-char-uuid}`
 *
 * @example
 * ```ts
 * generateRunId(); // "run_20260227_a1b2c3d4"
 * ```
 */
export function generateRunId(): string {
  const date = format(new Date(), 'yyyyMMdd');
  const short = uuidv4().split('-')[0];
  return `run_${date}_${short}`;
}

/**
 * Check if current git branch is a review branch.
 *
 * @returns `true` if branch name starts with `review/`, `false` otherwise
 *
 * @example
 * ```ts
 * isOnReviewBranch(); // true if on "review/main--dev-abc123"
 * ```
 */
export function isOnReviewBranch(): boolean {
  try {
    const branch = getCurrentBranch();
    return branch.startsWith('review/');
  } catch {
    return false;
  }
}

/**
 * Get the current git branch name.
 *
 * @returns Current branch name
 * @throws {Error} If not in a git repository or git command fails
 *
 * @example
 * ```ts
 * getCurrentBranch(); // "main" or "feature/my-feature"
 * ```
 */
export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
    }).trim();
  } catch (_error) {
    throw new Error(
      'Failed to get current branch. Are you in a git repository?',
    );
  }
}

/**
 * Get the default base branch (main/master/develop).
 *
 * Checks remote branches to determine the base branch name.
 * Prefers `main` → `master` → `develop` in that order.
 *
 * @returns Base branch name (defaults to `main` if none found)
 *
 * @example
 * ```ts
 * getBaseBranch(); // "main" or "master" depending on repo
 * ```
 */
export function getBaseBranch(): string {
  try {
    // Check if main exists
    const branches = execSync('git branch -r', { encoding: 'utf-8' });
    if (branches.includes('origin/main')) return 'main';
    if (branches.includes('origin/master')) return 'master';
    if (branches.includes('origin/develop')) return 'develop';
    return 'main'; // default
  } catch {
    return 'main';
  }
}

/**
 * Get the current commit SHA.
 *
 * @returns Short SHA of current HEAD commit, or `"unknown"` if git command fails
 *
 * @example
 * ```ts
 * getCurrentSha(); // "a1b2c3d4"
 * ```
 */
export function getCurrentSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Validate a git reference to prevent shell injection and path traversal.
 *
 * **Security**: This function validates refs before passing them to git commands.
 *
 * @param ref - Git reference to validate (branch name, tag, SHA, etc.)
 * @returns `true` if ref is safe, `false` otherwise
 *
 * @remarks
 * Allows: alphanumeric, dot, slash, underscore, hyphen, at-sign
 * Rejects: shell metacharacters, spaces, path traversal sequences (`..`)
 *
 * @example
 * ```ts
 * isValidGitRef('main'); // true
 * isValidGitRef('feature/my-feature'); // true
 * isValidGitRef('foo;rm -rf /'); // false (shell metacharacter)
 * isValidGitRef('../etc/passwd'); // false (path traversal)
 * ```
 */
export function isValidGitRef(ref: string): boolean {
  if (!ref || ref.length === 0 || ref.length > 256) {
    return false;
  }

  // Reject path traversal and shell metacharacters
  const dangerous = /[\s;|&$`\\(){}<>!*?[\]"']/;
  if (dangerous.test(ref)) {
    return false;
  }

  // Reject path traversal
  if (ref.includes('..')) {
    return false;
  }

  // Allow typical git ref characters: a-z A-Z 0-9 . / _ - @
  const validPattern = /^[a-zA-Z0-9._\/@-]+$/;
  return validPattern.test(ref);
}

/**
 * Resolve the commit SHA for a git reference.
 *
 * **Security**: Uses `execFileSync` (not template string) to prevent command injection.
 *
 * @param ref - Git reference (branch, tag, SHA, etc.)
 * @returns Short SHA for the reference, or `"unknown"` if resolution fails
 *
 * @example
 * ```ts
 * getShaForRef('main'); // "a1b2c3d4"
 * getShaForRef('v1.0.0'); // "e5f6g7h8"
 * ```
 */
export function getShaForRef(ref: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', ref], {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Slugify a branch name for use in review branch naming.
 *
 * Replaces slashes and spaces with underscores, and removes special characters.
 *
 * @param branch - Branch name to slugify
 * @returns Slugified branch name safe for git branch creation
 *
 * @example
 * ```ts
 * slugifyBranchName('feature/my-feature'); // "feature_my-feature"
 * slugifyBranchName('dev/bug fix'); // "dev_bug_fix"
 * ```
 */
export function slugifyBranchName(branch: string): string {
  return branch.replace(/[\/\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
}


/**
 * Build a review branch name from base, target, and short SHA.
 * Format: `review/<base>--<target>--<sha>`
 *
 * @param baseBranch - Base branch name (e.g., "main")
 * @param targetBranch - Target branch name (e.g., "dev")
 * @param shortSha - Short commit SHA for uniqueness
 * @returns Review branch name following the naming convention
 *
 * @example
 * ```ts
 * buildReviewBranchName('main', 'dev', 'a1b2c3d4');
 * // "review/main--dev--a1b2c3d4"
 * ```
 */

export function buildReviewBranchName(
  baseBranch: string,
  targetBranch: string,
  shortSha: string,
): string {
  return `review/${slugifyBranchName(baseBranch)}--${slugifyBranchName(targetBranch)}--${shortSha}`;
}

// Get current run
/**
 * Get the current active run metadata.
 *
 * Reads `current.json` from the review runs directory.
 *
 * @returns Current run metadata, or `null` if no active run exists
 *
 * @example
 * ```ts
 * getCurrentRun();
 * // { run_id: "run_20260227_a1b2", status: "running", ... }
 * ```
 */
export function getCurrentRun(): RunMetadata | null {
  const runFile = path.join(REVIEW_RUNS_DIR, 'current.json');
  if (!fs.existsSync(runFile)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(runFile, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get run metadata by run ID.
 *
 * **Security**: Validates `runId` format to prevent path traversal.
 * Only allows alphanumeric, dash, underscore characters.
 *
 * @param runId - Run ID to retrieve (e.g., "run_20260227_a1b2")
 * @returns Run metadata, or `null` if not found or runId is invalid
 *
 * @example
 * ```ts
 * getRunById("run_20260227_a1b2");
 * // { run_id: "run_20260227_a1b2", status: "pending", ... }
 * getRunById("../../etc/passwd"); // null (invalid characters)
 * ```
 */
export function getRunById(runId: string): RunMetadata | null {
  // Security: Prevent path traversal by validating runId format
  // Only allow alphanumeric, dash, underscore (typical run_YYYYMMDD_xxx format)
  if (!runId || /[^a-zA-Z0-9_-]/.test(runId)) {
    return null;
  }

  // Use path.basename as defense-in-depth to ensure single path segment
  const safeRunId = path.basename(runId);
  const runFile = path.join(REVIEW_RUNS_DIR, safeRunId, 'run.json');
  if (!fs.existsSync(runFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(runFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function getLastRun(): RunMetadata | null {
  if (!fs.existsSync(REVIEW_RUNS_DIR)) {
    return null;
  }

  const runDirs = fs
    .readdirSync(REVIEW_RUNS_DIR)
    .filter((entry) => entry.startsWith('run_'))
    .map((entry) => ({
      entry,
      fullPath: path.join(REVIEW_RUNS_DIR, entry),
    }))
    .filter(({ fullPath }) => {
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const aMtime = fs.statSync(a.fullPath).mtimeMs;
      const bMtime = fs.statSync(b.fullPath).mtimeMs;
      return bMtime - aMtime;
    });

  if (runDirs.length === 0) {
    return null;
  }

  return getRunById(runDirs[0].entry);
}

// Save current run
/**
 * Save or update the current run metadata.
 *
 * Writes to both `current.json` and the run-specific `run.json` file.
 *
 * @param run - Run metadata to save
 *
 * @example
 * ```ts
 * const run = getCurrentRun();
 * run.status = 'running';
 * saveCurrentRun(run);
 * ```
 */
export function saveCurrentRun(run: RunMetadata): void {
  ensureDir(REVIEW_RUNS_DIR);
  const runFile = path.join(REVIEW_RUNS_DIR, 'current.json');
  fs.writeFileSync(runFile, JSON.stringify(run, null, 2));
}

// Get run directory
/**
 * Get the directory path for a specific run ID.
 *
 * @param runId - Run ID to get directory for
 * @returns Absolute path to the run directory
 *
 * @example
 * ```ts
 * getRunDir("run_20260227_a1b2");
 * // "/path/to/project/_ctx/review_runs/run_20260227_a1b2"
 * ```
 */
export function getRunDir(runId: string): string {
  return path.join(REVIEW_RUNS_DIR, runId);
}

// Check if explorer files exist
export function explorerFilesExist(): { context: boolean; diff: boolean } {
  return {
    context: fs.existsSync(path.join(EXPLORE_DIR, 'context.md')),
    diff: fs.existsSync(path.join(EXPLORE_DIR, 'diff.md')),
  };
}

// Copy explorer files to run directory
export function copyExplorerFiles(runId: string): void {
  const runDir = getRunDir(runId);
  const exploreDest = path.join(runDir, 'explore');
  ensureDir(exploreDest);

  const { context, diff } = explorerFilesExist();

  if (context) {
    fs.copyFileSync(
      path.join(EXPLORE_DIR, 'context.md'),
      path.join(exploreDest, 'context.md'),
    );
  }

  if (diff) {
    fs.copyFileSync(
      path.join(EXPLORE_DIR, 'diff.md'),
      path.join(exploreDest, 'diff.md'),
    );
  }
}

// Get git diff stats
export function getDiffStats(): {
  files: number;
  added: number;
  removed: number;
} {
  try {
    const baseBranch = getBaseBranch();
    const diffstat = execSync(
      `git diff --shortstat ${baseBranch}...HEAD 2>/dev/null || git diff --shortstat HEAD~1`,
      { encoding: 'utf-8' },
    );

    const filesMatch = diffstat.match(/(\d+) files? changed/);
    const addedMatch = diffstat.match(/(\d+) insertions?/);
    const removedMatch = diffstat.match(/(\d+) deletions?/);

    return {
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      added: addedMatch ? parseInt(addedMatch[1], 10) : 0,
      removed: removedMatch ? parseInt(removedMatch[1], 10) : 0,
    };
  } catch {
    return { files: 0, added: 0, removed: 0 };
  }
}

// Get changed files list
export function getChangedFiles(): string[] {
  try {
    const baseBranch = getBaseBranch();
    const files = execSync(
      `git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1`,
      { encoding: 'utf-8' },
    );
    return files
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

// Validate preconditions
export function validatePreconditions(
  required: (
    | 'review_branch'
    | 'context'
    | 'diff'
    | 'plan_resolved'
    | 'no_drift'
  )[],
): void {
  const errors: string[] = [];

  if (required.includes('review_branch') && !isOnReviewBranch()) {
    errors.push(PRECONDITION_ERRORS.NOT_REVIEW_BRANCH);
  }

  const files = explorerFilesExist();

  if (required.includes('context') && !files.context) {
    errors.push(PRECONDITION_ERRORS.MISSING_CONTEXT);
  }

  if (required.includes('diff') && !files.diff) {
    errors.push(PRECONDITION_ERRORS.MISSING_DIFF);
  }

  const run = getCurrentRun();

  if (required.includes('plan_resolved') && run) {
    if (run.plan_status === 'MISSING' || run.plan_status === 'AMBIGUOUS') {
      errors.push(PRECONDITION_ERRORS.MISSING_PLAN);
    }
  }

  if (required.includes('no_drift') && run) {
    if (run.drift_status === 'DRIFT_CONFIRMED') {
      errors.push(PRECONDITION_ERRORS.DRIFT_CONFIRMED);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Precondition failures:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
}

export function computeDigest(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Compute SHA-256 digest of a file.
 *
 * Returns `null` if the file doesn't exist or cannot be read.
 *
 * @param filePath - Absolute path to the file to hash
 * @returns Hex-encoded SHA-256 digest, or `null` if file doesn't exist
 *
 * @example
 * ```ts
 * computeFileDigest("/path/to/file.md"); // "a1b2c3d4..."
 * computeFileDigest("/nonexistent.md"); // null
 * ```
 */
export function computeFileDigest(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return computeDigest(fs.readFileSync(filePath, 'utf-8'));
}

// Format duration
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
