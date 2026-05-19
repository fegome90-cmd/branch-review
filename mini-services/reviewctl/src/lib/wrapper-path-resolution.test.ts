import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const createdDirs: string[] = [];
const wrapperSource = path.resolve(
  'scripts/reviewctl-wrappers/reviewctl-wrapper.sh',
);

function createExternalWrapperRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-wrapper-'));
  createdDirs.push(repoDir);
  const wrapperDir = path.join(repoDir, 'scripts', 'reviewctl-wrappers');
  fs.mkdirSync(wrapperDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  fs.copyFileSync(wrapperSource, path.join(wrapperDir, 'reviewctl-wrapper.sh'));
  return repoDir;
}

function createExternalWrapperRepoAt(repoDir: string): string {
  createdDirs.push(path.dirname(repoDir));
  const wrapperDir = path.join(repoDir, 'scripts', 'reviewctl-wrappers');
  fs.mkdirSync(wrapperDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  fs.copyFileSync(wrapperSource, path.join(wrapperDir, 'reviewctl-wrapper.sh'));
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

describe('reviewctl wrapper path resolution', () => {
  it('fails closed outside branch-review when REVIEWCTL_CORE_CLI_PATH is missing', () => {
    const repoDir = createExternalWrapperRepo();
    const wrapperPath = path.join(
      repoDir,
      'scripts',
      'reviewctl-wrappers',
      'reviewctl-wrapper.sh',
    );

    expect(() =>
      execFileSync(
        'bash',
        [
          '-lc',
          `cd ${JSON.stringify(repoDir)} && source ${JSON.stringify(
            wrapperPath,
          )} && resolve_core_cli_path`,
        ],
        { encoding: 'utf-8' },
      ),
    ).toThrow();
  });

  it('uses explicit REVIEWCTL_CORE_CLI_PATH outside branch-review', () => {
    const repoDir = createExternalWrapperRepo();
    const wrapperPath = path.join(
      repoDir,
      'scripts',
      'reviewctl-wrappers',
      'reviewctl-wrapper.sh',
    );
    const explicitPath =
      '/tmp/branch-review/mini-services/reviewctl/src/index.ts';

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `cd ${JSON.stringify(repoDir)} && export REVIEWCTL_CORE_CLI_PATH=${JSON.stringify(
          explicitPath,
        )} && source ${JSON.stringify(wrapperPath)} && resolve_core_cli_path`,
      ],
      { encoding: 'utf-8' },
    ).trim();

    expect(output).toBe(explicitPath);
  });

  it('derives different artifact roots for same-basename repos', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapper-root-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapper-root-b-'));
    const repoA = createExternalWrapperRepoAt(path.join(rootA, 'app'));
    const repoB = createExternalWrapperRepoAt(path.join(rootB, 'app'));
    const cliPath = path.resolve('mini-services/reviewctl/src/index.ts');
    const wrapperA = path.join(
      repoA,
      'scripts',
      'reviewctl-wrappers',
      'reviewctl-wrapper.sh',
    );
    const wrapperB = path.join(
      repoB,
      'scripts',
      'reviewctl-wrappers',
      'reviewctl-wrapper.sh',
    );

    const artifactRootA = execFileSync(
      'bash',
      [
        '-lc',
        `cd ${JSON.stringify(repoA)} && export REVIEWCTL_CORE_CLI_PATH=${JSON.stringify(
          cliPath,
        )} && source ${JSON.stringify(wrapperA)} && resolve_artifact_root`,
      ],
      { encoding: 'utf-8' },
    ).trim();

    const artifactRootB = execFileSync(
      'bash',
      [
        '-lc',
        `cd ${JSON.stringify(repoB)} && export REVIEWCTL_CORE_CLI_PATH=${JSON.stringify(
          cliPath,
        )} && source ${JSON.stringify(wrapperB)} && resolve_artifact_root`,
      ],
      { encoding: 'utf-8' },
    ).trim();

    expect(artifactRootA).not.toBe(artifactRootB);
    expect(path.basename(artifactRootA)).toMatch(/^app-/);
    expect(path.basename(artifactRootB)).toMatch(/^app-/);
  });

  it('falls back to local mode on transport failure when token mode is enabled', () => {
    const repoDir = createExternalWrapperRepo();
    const wrapperPath = path.join(
      repoDir,
      'scripts',
      'reviewctl-wrappers',
      'reviewctl-wrapper.sh',
    );
    const cliPath = path.resolve('mini-services/reviewctl/src/index.ts');

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `cd ${JSON.stringify(repoDir)} && export REVIEWCTL_CORE_CLI_PATH=${JSON.stringify(
          cliPath,
        )} && export REVIEW_API_TOKEN=dummy-token && export BRANCH_REVIEW_API=http://127.0.0.1:9 && source ${JSON.stringify(
          wrapperPath,
        )} && reviewctl_doctor --json`,
      ],
      { encoding: 'utf-8' },
    );

    expect(output).toContain('"passed": true');
  });
});
