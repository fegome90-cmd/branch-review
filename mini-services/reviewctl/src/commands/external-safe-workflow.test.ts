import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getReviewctlArtifactRoot } from '../../../../shared/reviewctl-artifact-root';

const createdDirs: string[] = [];

function createRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-flow-'));
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
  execSync('git branch -M main', { cwd: repoDir, stdio: 'ignore' });

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'src', 'index.ts'),
    'export const x = 1;\n',
  );
  fs.mkdirSync(path.join(repoDir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'docs', 'plans', 'feature-safe.md'),
    '# plan\n',
  );

  execSync('git add .', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "init"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git checkout -b feature-safe', { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(
    path.join(repoDir, 'src', 'feature.ts'),
    'export const y = 2;\n',
  );
  execSync('git add src/feature.ts', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "feature"', {
    cwd: repoDir,
    stdio: 'ignore',
  });

  return repoDir;
}

function createRepoAt(
  repoDir: string,
  branchName: string,
  value: string,
): string {
  createdDirs.push(path.dirname(repoDir));

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# temp repo\n');
  fs.writeFileSync(
    path.join(repoDir, 'src', 'index.ts'),
    'export const x = 1;\n',
  );
  fs.writeFileSync(
    path.join(repoDir, 'docs', 'plans', 'feature-safe.md'),
    '# plan\n',
  );

  execSync('git init', { cwd: repoDir, stdio: 'ignore' });
  execSync('git config user.email "codex@example.com"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git config user.name "Codex"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git branch -M main', { cwd: repoDir, stdio: 'ignore' });
  execSync('git add .', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "init"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync(`git checkout -b ${branchName}`, {
    cwd: repoDir,
    stdio: 'ignore',
  });
  fs.writeFileSync(
    path.join(repoDir, 'src', 'feature.ts'),
    `export const y = ${value};\n`,
  );
  execSync('git add src/feature.ts', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "feature"', {
    cwd: repoDir,
    stdio: 'ignore',
  });

  return repoDir;
}

function runCli(repoDir: string, artifactRoot: string, ...args: string[]) {
  const cliPath = path.resolve('mini-services/reviewctl/src/index.ts');
  execFileSync('bun', [cliPath, ...args], {
    cwd: repoDir,
    env: {
      ...process.env,
      REVIEWCTL_SAFE_MODE: '1',
      REVIEWCTL_ARTIFACT_ROOT: artifactRoot,
    },
    stdio: 'ignore',
  });
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('external safe workflow', () => {
  it('runs init, explore, and plan without polluting the target repo root', () => {
    const repoDir = createRepo();
    const artifactRoot = path.join(repoDir, '.reviewctl-artifacts');

    runCli(repoDir, artifactRoot, 'init', '--base', 'main');
    runCli(repoDir, artifactRoot, 'explore', 'context');
    runCli(repoDir, artifactRoot, 'explore', 'diff');
    runCli(repoDir, artifactRoot, 'plan');

    expect(
      fs.existsSync(
        path.join(artifactRoot, '_ctx', 'review_runs', 'current.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(artifactRoot, 'explore', 'context.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(artifactRoot, 'explore', 'diff.md'))).toBe(
      true,
    );

    const runId = JSON.parse(
      fs.readFileSync(
        path.join(artifactRoot, '_ctx', 'review_runs', 'current.json'),
        'utf-8',
      ),
    ).run_id as string;

    expect(
      fs.existsSync(
        path.join(artifactRoot, '_ctx', 'review_runs', runId, 'plan.md'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '_ctx'))).toBe(false);
    expect(fs.existsSync(path.join(repoDir, 'explore'))).toBe(false);
  });

  it('isolates current run state for same-basename repos', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-same-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-same-b-'));
    const repoA = createRepoAt(path.join(rootA, 'app'), 'feature-one', '1');
    const repoB = createRepoAt(path.join(rootB, 'app'), 'feature-two', '2');

    runCli(repoA, '', 'init', '--base', 'main');
    runCli(repoB, '', 'init', '--base', 'main');

    const artifactRootA = getReviewctlArtifactRoot(repoA);
    const artifactRootB = getReviewctlArtifactRoot(repoB);

    expect(artifactRootA).not.toBe(artifactRootB);
    expect(
      fs.existsSync(
        path.join(artifactRootA, '_ctx', 'review_runs', 'current.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(artifactRootB, '_ctx', 'review_runs', 'current.json'),
      ),
    ).toBe(true);
  });
});
