import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cliPath = path.resolve('mini-services/reviewctl/src/index.ts');
const created: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function fixture(agentVerdict: 'PASS' | 'FAIL', missing = false, stale = false) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-gate-'));
  created.push(cwd);
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'reviewctl@example.invalid');
  git(cwd, 'config', 'user.name', 'Reviewctl Tests');
  git(cwd, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# fixture\n');
  git(cwd, 'add', 'README.md');
  git(cwd, '-c', 'commit.gpgsign=false', 'commit', '-m', 'init');
  git(cwd, 'checkout', '-b', 'review/fixture');
  const head = git(cwd, 'rev-parse', '--short', 'HEAD');
  const dir = path.join(cwd, '_ctx', 'review_runs', 'run_fixture');
  const reports = path.join(dir, 'reports');
  const tasks = path.join(dir, 'tasks', 'code-reviewer');
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(tasks, { recursive: true });
  fs.mkdirSync(path.join(dir, 'statics'), { recursive: true });
  fs.writeFileSync(path.join(reports, 'REQUEST_code-reviewer.md'), '# request\n');
  if (!missing) {
    fs.writeFileSync(path.join(reports, 'reviewer_code-reviewer.md'), '# Review\n');
    fs.writeFileSync(
      path.join(tasks, 'status.json'),
      JSON.stringify({ status: 'DONE', validation: { valid: true, warnings: [] } }),
    );
    fs.writeFileSync(
      path.join(tasks, 'result.json'),
      JSON.stringify({
        statistics: { p0_count: 0, p1_count: 0, p2_count: 0 },
        findings: [],
        verdict: { result: agentVerdict, justification: 'synthetic fixture' },
      }),
    );
  }
  fs.writeFileSync(
    path.join(cwd, '_ctx', 'review_runs', 'current.json'),
    JSON.stringify({
      run_id: 'run_fixture',
      branch: 'review/fixture',
      base_branch: 'main',
      target_branch: 'review/fixture',
      status: 'pending_ingest',
      plan_status: 'MISSING',
      head_sha_at_plan: stale ? 'deadbeef' : head,
      drift_status: 'ALIGNED',
    }),
  );
  return { cwd, dir };
}

function verdict(cwd: string, allowIncomplete = false) {
  return spawnSync(
    'bun',
    [cliPath, 'verdict', '--json', ...(allowIncomplete ? ['--allow-incomplete'] : [])],
    {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        REVIEWCTL_SAFE_MODE: '0',
        REVIEWCTL_ARTIFACT_ROOT: '',
      },
    },
  );
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('reviewctl verdict integration', () => {
  it('rejects agent FAIL even with zero P0', () => {
    const f = fixture('FAIL');
    const output = verdict(f.cwd);
    expect(output.status).toBe(1);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('FAIL');
    expect(final.agent_verdicts['code-reviewer']).toBe('FAIL');
    expect(final.merge_ready).toBe(false);
  });

  it('rejects missing reports despite --allow-incomplete', () => {
    const f = fixture('PASS', true);
    const output = verdict(f.cwd, true);
    expect(output.status).toBe(2);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('INCOMPLETE');
    expect(final.merge_ready).toBe(false);
  });

  it('rejects a review of an older HEAD', () => {
    const f = fixture('PASS', false, true);
    const output = verdict(f.cwd);
    expect(output.status).toBe(2);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('STALE');
    expect(final.merge_ready).toBe(false);
  });

  it('preserves a clean local PASS without claiming merge authorization', () => {
    const f = fixture('PASS');
    const output = verdict(f.cwd);
    expect(output.status).toBe(0);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('PASS');
    expect(final.merge_ready).toBe(false);
  });
  it('blocks a required static SKIP without an applicability reason', () => {
    const f = fixture('PASS');
    fs.writeFileSync(
      path.join(f.dir, 'plan.json'),
      JSON.stringify({
        required_agents: ['code-reviewer'],
        optional_agents: [],
        statics: [{ name: 'ruff', required: true, reason: 'Python gate' }],
      }),
    );
    fs.writeFileSync(
      path.join(f.dir, 'statics', 'ruff_status.json'),
      JSON.stringify({ status: 'SKIP' }),
    );

    const output = verdict(f.cwd);
    expect(output.status).toBe(1);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('FAIL');
    expect(final.static_gate.blocking).toEqual([
      expect.objectContaining({ tool: 'ruff', status: 'UNKNOWN' }),
    ]);
  });

  it('accepts an explicitly justified required static SKIP', () => {
    const f = fixture('PASS');
    fs.writeFileSync(
      path.join(f.dir, 'plan.json'),
      JSON.stringify({
        required_agents: ['code-reviewer'],
        optional_agents: [],
        statics: [{ name: 'ruff', required: true, reason: 'Python gate' }],
      }),
    );
    fs.writeFileSync(
      path.join(f.dir, 'statics', 'ruff_status.json'),
      JSON.stringify({ status: 'SKIP', reason: 'No Python changes in diff' }),
    );

    const output = verdict(f.cwd);
    expect(output.status).toBe(0);
    const final = JSON.parse(fs.readFileSync(path.join(f.dir, 'final.json'), 'utf-8'));
    expect(final.verdict).toBe('PASS');
    expect(final.static_gate.blocking).toEqual([]);
  });

});
