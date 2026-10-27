import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../index.ts', import.meta.url));
const temporaryRepos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function createRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-merge-'));
  temporaryRepos.push(cwd);
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'reviewctl@example.invalid');
  git(cwd, 'config', 'user.name', 'Reviewctl test');
  git(cwd, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '_ctx/\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# fixture\n');
  git(cwd, 'add', '.gitignore', 'README.md');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', 'base');
  const baseSha = git(cwd, 'rev-parse', 'HEAD');

  git(cwd, 'checkout', '-b', 'review/test');
  fs.writeFileSync(path.join(cwd, 'feature.txt'), 'reviewed content\n');
  git(cwd, 'add', 'feature.txt');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', 'feature');
  const headSha = git(cwd, 'rev-parse', 'HEAD');

  const run = {
    run_id: 'run_fixture',
    branch: 'review/test',
    base_branch: 'main',
    head_sha_at_plan: headSha.slice(0, 7),
    base_sha: baseSha.slice(0, 7),
    created_at: '2026-10-27T00:00:00Z',
    status: 'completed',
    plan_status: 'FOUND',
    drift_status: 'ALIGNED',
    drift_override_used: false,
  };
  const final = {
    run_id: run.run_id,
    branch: run.branch,
    base_branch: run.base_branch,
    verdict: 'PASS',
    reviewed_head_sha: headSha,
    reviewed_base_sha: baseSha,
    merge_ready: false,
    agent_verdicts: { 'code-reviewer': 'PASS' },
    statistics: { p0_total: 0 },
    static_gate: { required: [], blocking: [], passed: 0, total: 0 },
    drift: { status: 'ALIGNED', override_used: false },
  };
  const runsRoot = path.join(cwd, '_ctx', 'review_runs');
  const runDir = path.join(runsRoot, run.run_id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'plan.json'),
    JSON.stringify({
      required_agents: ['code-reviewer'],
      optional_agents: [],
      statics: [],
    }),
  );
  const writeState = () => {
    fs.writeFileSync(
      path.join(runsRoot, 'current.json'),
      JSON.stringify(run),
    );
    fs.writeFileSync(
      path.join(runDir, 'final.json'),
      JSON.stringify(final),
    );
  };
  writeState();
  return { cwd, baseSha, headSha, run, final, writeState };
}

function merge(cwd: string, ...args: string[]) {
  return spawnSync('bun', [cliPath, 'merge', ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      REVIEWCTL_SAFE_MODE: '0',
      REVIEWCTL_ARTIFACT_ROOT: '',
    },
  });
}

afterEach(() => {
  for (const repo of temporaryRepos.splice(0)) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

describe('reviewctl merge with real synthetic Git repositories', () => {
  test('merges exactly the reviewed SHA locally and never pushes', () => {
    const f = createRepo();
    const result = merge(f.cwd);
    expect(result.status).toBe(0);
    expect(git(f.cwd, 'branch', '--show-current')).toBe('main');
    expect(fs.readFileSync(path.join(f.cwd, 'feature.txt'), 'utf-8')).toBe(
      'reviewed content\n',
    );
    const parents = git(f.cwd, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ');
    expect(parents).toHaveLength(3);
    expect(parents[2]).toBe(f.headSha);
    expect(result.stdout + result.stderr).toContain('No push performed');
  });

  test('supports a local squash merge', () => {
    const f = createRepo();
    const result = merge(f.cwd, '--squash');
    expect(result.status).toBe(0);
    expect(git(f.cwd, 'branch', '--show-current')).toBe('main');
    expect(git(f.cwd, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(2);
    expect(fs.existsSync(path.join(f.cwd, 'feature.txt'))).toBe(true);
  });

  test('blocks HEAD changes after review without switching branches', () => {
    const f = createRepo();
    fs.writeFileSync(path.join(f.cwd, 'unreviewed.txt'), 'unreviewed\n');
    git(f.cwd, 'add', 'unreviewed.txt');
    git(f.cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', 'unreviewed');
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot merge');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
    expect(git(f.cwd, 'rev-parse', 'main')).toBe(f.baseSha);
  });

  test('blocks updated base after review', () => {
    const f = createRepo();
    git(f.cwd, 'switch', 'main');
    fs.writeFileSync(path.join(f.cwd, 'new-base.txt'), 'updated\n');
    git(f.cwd, 'add', 'new-base.txt');
    git(f.cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', 'advance base');
    git(f.cwd, 'switch', 'review/test');
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot merge');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('blocks legacy PASS without full-SHA provenance', () => {
    const f = createRepo();
    f.final.reviewed_head_sha = '';
    f.writeState();
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verdict does not match current HEAD');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('rejects force even if the stored review says PASS', () => {
    const f = createRepo();
    const result = merge(f.cwd, '--force');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--force cannot bypass');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('rejects a final FAIL even when --force is supplied', () => {
    const f = createRepo();
    f.final.verdict = 'FAIL';
    f.writeState();
    const result = merge(f.cwd, '--force');
    expect(result.status).not.toBe(0);
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('rejects a verdict from another run', () => {
    const f = createRepo();
    f.final.run_id = 'run_other';
    f.writeState();
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('another run');
  });

  test('blocks tracked local modifications', () => {
    const f = createRepo();
    fs.appendFileSync(path.join(f.cwd, 'README.md'), 'dirty\n');
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('working tree is not clean');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('rejects injected branch metadata without executing commands', () => {
    const f = createRepo();
    const marker = path.join(f.cwd, 'shell-executed');
    f.run.base_branch = `main;touch ${marker}`;
    f.final.base_branch = f.run.base_branch;
    f.writeState();
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsafe branch metadata');
    expect(fs.existsSync(marker)).toBe(false);
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('rejects mismatched branch and stays on current branch', () => {
    const f = createRepo();
    f.run.branch = 'review/other';
    f.final.branch = 'review/other';
    f.writeState();
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('current branch differs');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });
  test('real ingest -> verdict -> merge uses both full commit SHAs', () => {
    const f = createRepo();
    const root = path.join(f.cwd, '_ctx', 'review_runs', f.run.run_id);
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(root, 'statics'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'plan.json'),
      JSON.stringify({
        required_agents: ['code-reviewer'],
        optional_agents: [],
        statics: [],
      }),
    );
    const report = path.join(root, 'reviewer-input.md');
    fs.writeFileSync(
      report,
      '## Summary\nNo findings\n\n## Verdict\n**PASS** - Reviewed synthetic change\n',
    );
    const options = {
      cwd: f.cwd,
      encoding: 'utf-8' as const,
      env: {
        ...process.env,
        REVIEWCTL_SAFE_MODE: '0',
        REVIEWCTL_ARTIFACT_ROOT: '',
      },
    };
    const ingest = spawnSync(
      'bun',
      [cliPath, 'ingest', '--agent', 'code-reviewer', '--input', report],
      options,
    );
    expect(ingest.status).toBe(0);
    const verdict = spawnSync('bun', [cliPath, 'verdict', '--json'], options);
    expect(verdict.status).toBe(0);

    const final = JSON.parse(
      fs.readFileSync(path.join(root, 'final.json'), 'utf-8'),
    );
    expect(final.verdict).toBe('PASS');
    expect(final.reviewed_head_sha).toBe(f.headSha);
    expect(final.reviewed_base_sha).toBe(f.baseSha);
    expect(final.merge_ready).toBe(false);

    const merged = merge(f.cwd);
    expect(merged.status).toBe(0);
    expect(git(f.cwd, 'branch', '--show-current')).toBe('main');
    expect(git(f.cwd, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')[2]).toBe(
      f.headSha,
    );
  });


  test('blocks merge when a required reviewer verdict is missing', () => {
    const f = createRepo();
    const plan = path.join(
      f.cwd, '_ctx', 'review_runs', f.run.run_id, 'plan.json',
    );
    fs.writeFileSync(
      plan,
      JSON.stringify({
        required_agents: ['code-reviewer', 'code-simplifier'],
        optional_agents: [],
        statics: [],
      }),
    );
    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required agent review evidence is incomplete');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });

  test('reports non-ancestor base without changing branch', () => {
    const f = createRepo();
    const unrelated = git(
      f.cwd,
      'commit-tree',
      git(f.cwd, 'rev-parse', 'HEAD^{tree}'),
      '-m',
      'unrelated root',
    );
    git(f.cwd, 'branch', '-f', 'main', unrelated);
    f.run.base_sha = unrelated.slice(0, 7);
    f.final.reviewed_base_sha = unrelated;
    f.writeState();

    const result = merge(f.cwd);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('reviewed base is not an ancestor');
    expect(git(f.cwd, 'branch', '--show-current')).toBe('review/test');
  });


});
