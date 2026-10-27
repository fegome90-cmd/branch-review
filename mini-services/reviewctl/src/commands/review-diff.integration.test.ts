import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../index.ts', import.meta.url));
const fixtures: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function createReview() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-diff-cli-'));
  fixtures.push(cwd);
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'synthetic@example.invalid');
  git(cwd, 'config', 'user.name', 'Synthetic');
  git(cwd, 'branch', '-M', 'main');

  fs.mkdirSync(path.join(cwd, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.gitignore'), '_ctx/\nexplore/\n');
  fs.writeFileSync(path.join(cwd, 'docs', 'plans', 'review-feature.md'), '# plan\n');
  fs.writeFileSync(path.join(cwd, 'README.md'), 'initial\n');
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'root');

  git(cwd, 'switch', '-c', 'release/1.0');
  fs.writeFileSync(path.join(cwd, 'release.ts'), 'export const release = true;\n');
  git(cwd, 'add', 'release.ts');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'release');
  const baseSha = git(cwd, 'rev-parse', 'HEAD');

  git(cwd, 'switch', '-c', 'review/feature');
  fs.writeFileSync(path.join(cwd, 'feature.ts'), 'export const feature = true;\n');
  git(cwd, 'add', 'feature.ts');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'feature');
  const headSha = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, baseSha, headSha };
}

function invoke(cwd: string, ...args: string[]) {
  return spawnSync('bun', [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      REVIEWCTL_SAFE_MODE: '0',
      REVIEWCTL_ARTIFACT_ROOT: '',
    },
  });
}

function check(cwd: string, ...args: string[]) {
  const result = invoke(cwd, ...args);
  if (result.status !== 0) {
    throw new Error(
      `reviewctl ${args.join(' ')} exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result;
}

function state(cwd: string) {
  const root = path.join(cwd, '_ctx', 'review_runs');
  const current = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf-8'));
  return { current, dir: path.join(root, current.run_id) };
}

function start(cwd: string) {
  check(cwd, 'init', '--base', 'release/1.0');
  check(cwd, 'explore', 'context');
  check(cwd, 'explore', 'diff');
  check(cwd, 'plan', '--level', 'quick', '--plan-path', 'docs/plans/review-feature.md');
  check(cwd, 'run');
}

afterEach(() => {
  for (const cwd of fixtures.splice(0)) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

describe('reviewctl diff scope across CLI phases', () => {
  test('T04/T11: init->explore->plan->run->ingest->verdict uses release base', () => {
    const f = createReview();
    start(f.cwd);

    const { current, dir } = state(f.cwd);
    expect(current.status).toBe('pending_ingest');
    expect(current.base_branch).toBe('release/1.0');
    const diff = fs.readFileSync(path.join(f.cwd, 'explore', 'diff.md'), 'utf-8');
    expect(diff).toContain(f.baseSha);
    expect(diff).toContain(f.headSha);
    expect(diff).toContain('Merge-base SHA');
    // The diff report summarizes scope by metrics/directories, not filenames.
    // Comparing against main would contain two files; release/1.0 has one.
    expect(diff).toContain('| Files Changed | 1 |');

    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8'));
    expect(plan.required_agents).toEqual(['code-reviewer', 'code-simplifier']);

    const report = path.join(f.cwd, 'synthetic-report.md');
    fs.writeFileSync(
      report,
      '## Summary\nSynthetic review: no findings\n\n## Verdict\n**PASS** - Synthetic fixture\n',
    );
    // The current aggregator includes optional requested agents in gate state;
    // ingest every generated request in this end-to-end success fixture.
    for (const agent of [...plan.required_agents, ...plan.optional_agents]) {
      check(f.cwd, 'ingest', '--agent', agent, '--input', report);
    }

    check(f.cwd, 'verdict', '--json');
    const final = JSON.parse(fs.readFileSync(path.join(dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('PASS');
    expect(final.reviewed_head_sha).toBe(f.headSha);
    expect(final.reviewed_base_sha).toBe(f.baseSha);
    expect(final.statistics.files_changed).toBe(1);
    expect(final.merge_ready).toBe(false);
  });

  test('T12: deleting base after init blocks exploration and planning', () => {
    const f = createReview();
    check(f.cwd, 'init', '--base', 'release/1.0');
    git(f.cwd, 'branch', '-D', 'release/1.0');

    const explore = invoke(f.cwd, 'explore', 'context');
    expect(explore.status).not.toBe(0);
    expect(explore.stderr + explore.stdout).toContain('DIFF_GIT_FAILED');
    expect(fs.existsSync(path.join(f.cwd, 'explore', 'context.md'))).toBe(false);

    expect(invoke(f.cwd, 'plan', '--plan-path', 'docs/plans/review-feature.md').status).not.toBe(0);
    expect(invoke(f.cwd, 'run').status).not.toBe(0);
    expect(state(f.cwd).current.status).toBe('pending');
  });

  test('T12: stale cached context cannot produce verdict PASS after base deletion', () => {
    const f = createReview();
    start(f.cwd);
    const { dir } = state(f.cwd);
    git(f.cwd, 'branch', '-D', 'release/1.0');

    const explore = invoke(f.cwd, 'explore', 'context');
    expect(explore.status).not.toBe(0);
    expect(explore.stdout + explore.stderr).toContain('DIFF_GIT_FAILED');
    const run = invoke(f.cwd, 'run');
    expect(run.status).not.toBe(0);

    const verdict = invoke(f.cwd, 'verdict', '--json');
    expect(verdict.status).not.toBe(0);
    const finalPath = path.join(dir, 'final.json');
    if (fs.existsSync(finalPath)) {
      expect(JSON.parse(fs.readFileSync(finalPath, 'utf-8')).verdict).not.toBe('PASS');
    }
  });
});
