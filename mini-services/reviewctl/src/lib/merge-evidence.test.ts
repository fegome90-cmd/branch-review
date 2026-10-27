import { describe, expect, test } from 'bun:test';
import type { RunMetadata } from './constants.js';
import {
  assertMergeEvidence,
  isSafeBranchName,
  type MergeSnapshot,
} from './merge-evidence.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function fixture() {
  const run: RunMetadata = {
    run_id: 'run_fixture',
    branch: 'review/test',
    base_branch: 'main',
    base_sha: BASE.slice(0, 7),
    head_sha_at_plan: HEAD.slice(0, 7),
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
    reviewed_head_sha: HEAD,
    reviewed_base_sha: BASE,
    agent_verdicts: { 'code-reviewer': 'PASS' },
    statistics: { p0_total: 0 },
    static_gate: { required: [], blocking: [], passed: 0, total: 0 },
    drift: { status: 'ALIGNED', override_used: false },
    merge_ready: false,
  };
  const snapshot: MergeSnapshot = {
    branch: run.branch,
    headSha: HEAD,
    baseSha: BASE,
  };
  return { run, final, snapshot };
}

describe('merge evidence fail-closed gate', () => {
  test('accepts a complete matching local review', () => {
    const f = fixture();
    expect(() => assertMergeEvidence(f.run, f.final, f.snapshot)).not.toThrow();
  });

  const scenarios = [
    ['head changed', (f: ReturnType<typeof fixture>) => { f.snapshot.headSha = 'c'.repeat(40); }],
    ['base changed', (f: ReturnType<typeof fixture>) => { f.snapshot.baseSha = 'c'.repeat(40); }],
    ['missing head proof', (f: ReturnType<typeof fixture>) => { f.final.reviewed_head_sha = ''; }],
    ['missing base proof', (f: ReturnType<typeof fixture>) => { f.final.reviewed_base_sha = ''; }],
    ['wrong run id', (f: ReturnType<typeof fixture>) => { f.final.run_id = 'run_other'; }],
    ['wrong branch', (f: ReturnType<typeof fixture>) => { f.snapshot.branch = 'review/other'; }],
    ['uncompleted review', (f: ReturnType<typeof fixture>) => { f.run.status = 'pending_ingest'; }],
    ['plan head stale', (f: ReturnType<typeof fixture>) => { f.run.head_sha_at_plan = 'd'.repeat(7); }],
    ['plan base stale', (f: ReturnType<typeof fixture>) => { f.run.base_sha = 'd'.repeat(7); }],
    ['drift override', (f: ReturnType<typeof fixture>) => { f.run.drift_override_used = true; }],
    ['failed agent', (f: ReturnType<typeof fixture>) => { f.final.agent_verdicts['code-reviewer'] = 'FAIL'; }],
    ['critical finding', (f: ReturnType<typeof fixture>) => { f.final.statistics.p0_total = 1; }],
    ['missing static gate', (f: ReturnType<typeof fixture>) => { f.final.static_gate.total = 1; }],
    ['malicious branch', (f: ReturnType<typeof fixture>) => { f.run.base_branch = 'main;touch hacked'; }],
    ['incomplete verdict', (f: ReturnType<typeof fixture>) => { f.final.verdict = 'INCOMPLETE'; }],
  ] as const;

  for (const [name, mutate] of scenarios) {
    test('blocks ' + name, () => {
      const f = fixture();
      mutate(f);
      expect(() => assertMergeEvidence(f.run, f.final, f.snapshot)).toThrow(/Cannot merge/);
    });
  }

  test('rejects branch shell metacharacters', () => {
    expect(isSafeBranchName('main; touch hacked')).toBe(false);
    expect(isSafeBranchName('review/../../main')).toBe(false);
    expect(isSafeBranchName('review/safe')).toBe(true);
  });
});
