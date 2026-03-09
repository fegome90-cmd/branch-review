import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const createdDirs: string[] = [];

function createReviewRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-save-run-'));
  createdDirs.push(repoDir);
  fs.mkdirSync(path.join(repoDir, '_ctx', 'review_runs'), { recursive: true });
  return repoDir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('saveCurrentRun', () => {
  test('writes both current.json and run.json for the active run', () => {
    const repoDir = createReviewRepo();

    const script = `
      import { saveCurrentRun } from '${path.resolve('mini-services/reviewctl/src/lib/utils.ts').replace(/\\/g, '\\\\')}';
      saveCurrentRun({
        run_id: 'run_20260309_feedbeef',
        branch: 'review/main--feature--feedbeef',
        base_branch: 'main',
        target_branch: 'feature',
        created_at: new Date().toISOString(),
        status: 'running',
        plan_status: 'FOUND',
      });
    `;

    execFileSync('bun', ['-e', script], {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const currentJson = JSON.parse(
      fs.readFileSync(
        path.join(repoDir, '_ctx', 'review_runs', 'current.json'),
        'utf-8',
      ),
    );
    const runJson = JSON.parse(
      fs.readFileSync(
        path.join(
          repoDir,
          '_ctx',
          'review_runs',
          'run_20260309_feedbeef',
          'run.json',
        ),
        'utf-8',
      ),
    );

    expect(currentJson.run_id).toBe('run_20260309_feedbeef');
    expect(runJson.run_id).toBe('run_20260309_feedbeef');
    expect(runJson.status).toBe('running');
  });
});
