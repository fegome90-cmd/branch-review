import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const originalSafeMode = process.env.REVIEWCTL_SAFE_MODE;
const originalArtifactRoot = process.env.REVIEWCTL_ARTIFACT_ROOT;
const createdDirs: string[] = [];

function createFeatureRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-init-'));
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

  fs.writeFileSync(path.join(repoDir, 'README.md'), '# temp repo\n');
  execSync('git add README.md', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c commit.gpgsign=false commit -m "init"', {
    cwd: repoDir,
    stdio: 'ignore',
  });
  execSync('git checkout -b feature/safe-mode', {
    cwd: repoDir,
    stdio: 'ignore',
  });

  return repoDir;
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env.REVIEWCTL_SAFE_MODE = originalSafeMode;
  process.env.REVIEWCTL_ARTIFACT_ROOT = originalArtifactRoot;

  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('initCommand safe mode', () => {
  it('initializes without creating a review branch and writes state under artifact root', async () => {
    const repoDir = createFeatureRepo();
    const artifactRoot = path.join(repoDir, '.artifacts');
    const cliPath = path.resolve('mini-services/reviewctl/src/index.ts');

    execFileSync('bun', [cliPath, 'init', '--base', 'main'], {
      cwd: repoDir,
      env: {
        ...process.env,
        REVIEWCTL_SAFE_MODE: '1',
        REVIEWCTL_ARTIFACT_ROOT: artifactRoot,
      },
      stdio: 'ignore',
    });

    const currentBranch = execSync('git branch --show-current', {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();

    expect(currentBranch).toBe('feature/safe-mode');
    expect(
      fs.existsSync(
        path.join(artifactRoot, '_ctx', 'review_runs', 'current.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoDir, '_ctx', 'review_runs', 'current.json')),
    ).toBe(false);
  });
});
