import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import {
  REVIEW_RUNS_DIR,
  EXPLORE_DIR,
  PROJECT_ROOT,
  RunMetadata,
  PlanStatus,
  PRECONDITION_ERRORS
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
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    throw new Error('Failed to get current branch. Are you in a git repository?');
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
    diff: fs.existsSync(path.join(EXPLORE_DIR, 'diff.md'))
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
      path.join(exploreDest, 'context.md')
    );
  }
  
  if (diff) {
    fs.copyFileSync(
      path.join(EXPLORE_DIR, 'diff.md'),
      path.join(exploreDest, 'diff.md')
    );
  }
}

// Get git diff stats
export function getDiffStats(): { files: number; added: number; removed: number } {
  try {
    const baseBranch = getBaseBranch();
    const diffstat = execSync(`git diff --shortstat ${baseBranch}...HEAD 2>/dev/null || git diff --shortstat HEAD~1`, { encoding: 'utf-8' });
    
    const filesMatch = diffstat.match(/(\d+) files? changed/);
    const addedMatch = diffstat.match(/(\d+) insertions?/);
    const removedMatch = diffstat.match(/(\d+) deletions?/);
    
    return {
      files: filesMatch ? parseInt(filesMatch[1]) : 0,
      added: addedMatch ? parseInt(addedMatch[1]) : 0,
      removed: removedMatch ? parseInt(removedMatch[1]) : 0
    };
  } catch {
    return { files: 0, added: 0, removed: 0 };
  }
}

// Get changed files list
export function getChangedFiles(): string[] {
  try {
    const baseBranch = getBaseBranch();
    const files = execSync(`git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1`, { encoding: 'utf-8' });
    return files.trim().split('\n').filter(f => f.length > 0);
  } catch {
    return [];
  }
}

// Validate preconditions
export function validatePreconditions(required: ('review_branch' | 'context' | 'diff' | 'plan_resolved' | 'no_drift')[]): void {
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
    throw new Error(`Precondition failures:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}

// Format duration
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
