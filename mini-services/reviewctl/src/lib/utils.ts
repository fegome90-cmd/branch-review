import { execSync } from 'node:child_process';
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

// Ensure directory exists
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Generate run ID
export function generateRunId(): string {
  const date = format(new Date(), 'yyyyMMdd');
  const short = uuidv4().split('-')[0];
  return `run_${date}_${short}`;
}

// Check if on review branch
export function isOnReviewBranch(): boolean {
  try {
    const branch = getCurrentBranch();
    return branch.startsWith('review/');
  } catch {
    return false;
  }
}

// Get current branch name
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

// Get base branch (main/master)
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

// Get current commit SHA
export function getCurrentSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Resolve commit SHA for a branch/ref
export function getShaForRef(ref: string): string {
  try {
    return execSync(`git rev-parse --short ${ref}`, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function slugifyBranchName(branch: string): string {
  return branch.replace(/[\/\s]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildReviewBranchName(
  baseBranch: string,
  targetBranch: string,
  shortSha: string,
): string {
  return `review/${slugifyBranchName(baseBranch)}--${slugifyBranchName(targetBranch)}--${shortSha}`;
}

// Get current run
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

export function getRunById(runId: string): RunMetadata | null {
  const runFile = path.join(REVIEW_RUNS_DIR, runId, 'run.json');
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
export function saveCurrentRun(run: RunMetadata): void {
  ensureDir(REVIEW_RUNS_DIR);
  const runFile = path.join(REVIEW_RUNS_DIR, 'current.json');
  fs.writeFileSync(runFile, JSON.stringify(run, null, 2));
}

// Get run directory
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
