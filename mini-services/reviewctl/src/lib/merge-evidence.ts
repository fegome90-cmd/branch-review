import type { RunMetadata } from './constants.js';

export type MergeSnapshot = {
  branch: string;
  headSha: string;
  baseSha: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fullSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
}

function matchesRecordedSha(recorded: unknown, full: string): boolean {
  return (
    typeof recorded === 'string' &&
    /^[0-9a-f]{7,64}$/.test(recorded) &&
    full.startsWith(recorded)
  );
}

/** Branch references from on-disk run metadata are untrusted input. */
export function isSafeBranchName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith('-') &&
    !name.includes('..') &&
    !name.includes('@{') &&
    /^[a-zA-Z0-9_./-]+$/.test(name)
  );
}

/**
 * Fail closed before any checkout, merge, or push.
 * A review-only PASS is not a GitHub authorization to merge a PR.
 */
export function assertMergeEvidence(
  run: RunMetadata,
  final: unknown,
  snapshot: MergeSnapshot,
): void {
  if (!/^run_[a-zA-Z0-9_-]+$/.test(run.run_id)) {
    throw new Error('Cannot merge: invalid run ID');
  }
  if (
    !isSafeBranchName(run.branch) ||
    !run.branch.startsWith('review/') ||
    !isSafeBranchName(run.base_branch) ||
    run.branch === run.base_branch
  ) {
    throw new Error('Cannot merge: invalid review/base branch metadata');
  }
  if (snapshot.branch !== run.branch) {
    throw new Error('Cannot merge: current branch differs from reviewed branch');
  }
  if (run.plan_status !== 'FOUND') {
    throw new Error('Cannot merge: review plan was not resolved');
  }
  if (run.status !== 'completed') {
    throw new Error('Cannot merge: review run is not complete');
  }
  if (run.drift_status !== 'ALIGNED' || run.drift_override_used) {
    throw new Error('Cannot merge: review drift is not aligned');
  }
  if (!fullSha(snapshot.headSha) || !fullSha(snapshot.baseSha)) {
    throw new Error('Cannot merge: Git HEAD/base SHA unavailable');
  }
  if (!matchesRecordedSha(run.head_sha_at_plan, snapshot.headSha)) {
    throw new Error('Cannot merge: planned commit is stale');
  }
  if (!matchesRecordedSha(run.base_sha, snapshot.baseSha)) {
    throw new Error('Cannot merge: reviewed base has changed');
  }

  if (!isRecord(final) || final.verdict !== 'PASS') {
    throw new Error('Cannot merge: required PASS verdict is missing');
  }
  if (
    final.run_id !== run.run_id ||
    final.branch !== run.branch ||
    final.base_branch !== run.base_branch
  ) {
    throw new Error('Cannot merge: verdict belongs to another run or branch');
  }
  if (final.reviewed_head_sha !== snapshot.headSha) {
    throw new Error('Cannot merge: verdict does not match current HEAD');
  }
  if (final.reviewed_base_sha !== snapshot.baseSha) {
    throw new Error('Cannot merge: verdict does not match current base');
  }
  if (
    !isRecord(final.drift) ||
    final.drift.status !== 'ALIGNED' ||
    final.drift.override_used === true
  ) {
    throw new Error('Cannot merge: verdict drift evidence is not aligned');
  }
  if (
    !isRecord(final.statistics) ||
    final.statistics.p0_total !== 0 ||
    !isRecord(final.static_gate) ||
    !Array.isArray(final.static_gate.blocking) ||
    final.static_gate.blocking.length !== 0 ||
    !Number.isSafeInteger(final.static_gate.total) ||
    !Number.isSafeInteger(final.static_gate.passed) ||
    (final.static_gate.total as number) < 0 ||
    final.static_gate.passed !== final.static_gate.total
  ) {
    throw new Error('Cannot merge: inconsistent blocking findings or static gates');
  }
  if (
    !isRecord(final.agent_verdicts) ||
    Object.keys(final.agent_verdicts).length === 0 ||
    Object.values(final.agent_verdicts).some((value) => value !== 'PASS')
  ) {
    throw new Error('Cannot merge: agent review evidence is incomplete');
  }
}
