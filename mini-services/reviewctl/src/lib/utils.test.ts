import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const createdDirs: string[] = [];

function createReviewRepo(options?: {
  planStatus?: 'AMBIGUOUS' | 'MISSING';
  withResolvedPlan?: boolean;
}): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-utils-'));
  createdDirs.push(repoDir);

  execSync('git init', { cwd: repoDir, stdio: 'ignore' });
  execSync('git config user.email "codex@example.com"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git config user.name "Codex"', {
    cwd: repoDir,
    stdio: 'ignore',
  });

  fs.writeFileSync(path.join(repoDir, 'README.md'), '# temp repo\n');
  execSync('git add README.md', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "init"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git checkout -b review/main--feature--abc12345', {
    cwd: repoDir,
    stdio: 'ignore',
  });

  fs.mkdirSync(path.join(repoDir, 'explore'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'explore', 'context.md'), 'context ok\n');
  fs.writeFileSync(path.join(repoDir, 'explore', 'diff.md'), 'diff ok\n');

  fs.mkdirSync(path.join(repoDir, '_ctx', 'review_runs'), { recursive: true });
  const runId = 'run_20260307_deadbeef';
  const runDir = path.join(repoDir, '_ctx', 'review_runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  if (options?.withResolvedPlan) {
    fs.writeFileSync(path.join(runDir, 'plan.md'), '# plan\n');
    fs.writeFileSync(path.join(runDir, 'plan.json'), '{"statics":[]}\n');
  }

  fs.writeFileSync(
    path.join(repoDir, '_ctx', 'review_runs', 'current.json'),
    JSON.stringify(
      {
        run_id: runId,
        branch: 'review/main--feature--abc12345',
        base_branch: 'main',
        target_branch: 'feature',
        status: 'planning',
        plan_status: options?.planStatus ?? 'AMBIGUOUS',
        plan_digest: options?.withResolvedPlan ? 'digest-1234' : undefined,
        drift_status: 'DRIFT_RISK',
      },
      null,
      2,
    ),
  );

  return repoDir;
}

async function loadUtilsModule() {
  return import(`./utils.js?ts=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  process.chdir(originalCwd);
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('validatePreconditions', () => {
  test('enforces a concrete plan snapshot when plan_resolved is requested', async () => {
    const repoDir = createReviewRepo({
      planStatus: 'AMBIGUOUS',
      withResolvedPlan: true,
    });
    process.chdir(repoDir);

    const { validatePreconditions } = await loadUtilsModule();

    expect(() =>
      validatePreconditions([
        'review_branch',
        'context',
        'diff',
        'plan_resolved',
      ]),
    ).not.toThrow();

    fs.rmSync(
      path.join(
        repoDir,
        '_ctx',
        'review_runs',
        'run_20260307_deadbeef',
        'plan.md',
      ),
    );

    expect(() => validatePreconditions(['plan_resolved'])).toThrow(
      'Plan is MISSING or AMBIGUOUS. Provide --plan-path or resolve manually.',
    );
  });
});
