import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

export type ReviewDiffSnapshot = {
  baseRef: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  changedFiles: string[];
  stats: { files: number; added: number; removed: number };
};

export class ReviewDiffScopeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(code + ': ' + message);
    this.name = 'ReviewDiffScopeError';
  }
}

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_DIFF_BYTES = 16 * 1024 * 1024;

function git(args: string[], stage: string): Buffer {
  try {
    return execFileSync('git', args, {
      maxBuffer: MAX_DIFF_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    });
  } catch {
    throw new ReviewDiffScopeError(
      'DIFF_GIT_FAILED',
      'Git failed during ' + stage +
        '. Verify the local base ref and history; fetch explicitly if the checkout is incomplete.',
    );
  }
}

function resolveSha(ref: string, stage: string): string {
  const sha = git(
    ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'],
    stage,
  ).toString('utf8').trim();
  if (!SHA_PATTERN.test(sha)) {
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_SHA',
      stage + ' did not resolve to one full commit SHA.',
    );
  }
  return sha;
}

function parseNames(data: Buffer): string[] {
  if (data.length === 0) return [];
  if (data[data.length - 1] !== 0) {
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_PATHS',
      'Git filename output is not NUL-terminated.',
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names: string[] = [];
  let start = 0;
  try {
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] !== 0) continue;
      if (i === start) {
        throw new ReviewDiffScopeError(
          'DIFF_INVALID_PATHS',
          'Git returned an empty filename.',
        );
      }
      names.push(decoder.decode(data.subarray(start, i)));
      start = i + 1;
    }
  } catch (error) {
    if (error instanceof ReviewDiffScopeError) throw error;
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_UTF8',
      'A changed Git filename is not losslessly representable as UTF-8.',
    );
  }
  return names;
}

function parseStats(data: Buffer, fileCount: number): ReviewDiffSnapshot['stats'] {
  const summary = data.toString('utf8').trim();
  if (summary.length === 0 && fileCount === 0) {
    return { files: 0, added: 0, removed: 0 };
  }
  const match = summary.match(
    /^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/,
  );
  if (!match) {
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_STATS',
      'Git shortstat is missing or malformed; refusing to assume zero changes.',
    );
  }
  const stats = {
    files: Number(match[1]),
    added: Number(match[2] || 0),
    removed: Number(match[3] || 0),
  };
  if (
    Object.values(stats).some((value) => !Number.isSafeInteger(value)) ||
    stats.files !== fileCount
  ) {
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_STATS',
      'Git shortstat does not match the changed-files list.',
    );
  }
  return stats;
}

/** Review branch diff against its unique merge-base. No fallback to HEAD~1. */
export function getReviewDiffSnapshot(baseRef: string): ReviewDiffSnapshot {
  if (
    typeof baseRef !== 'string' ||
    !/^[a-zA-Z0-9._/@-]+$/.test(baseRef) ||
    baseRef.startsWith('-') ||
    baseRef.includes('..') ||
    baseRef.includes('@{')
  ) {
    throw new ReviewDiffScopeError(
      'DIFF_INVALID_BASE',
      'A valid explicit base branch is required (from run.base_branch).',
    );
  }

  const shallow = git(['rev-parse', '--is-shallow-repository'], 'shallow check')
    .toString('utf8')
    .trim();
  if (shallow !== 'false') {
    throw new ReviewDiffScopeError(
      'DIFF_INCOMPLETE_HISTORY',
      'The local Git history is shallow or unverified. Obtain complete history explicitly.',
    );
  }

  const baseSha = resolveSha(baseRef, 'base resolution');
  const headSha = resolveSha('HEAD', 'HEAD resolution');
  const ancestors = git(
    ['merge-base', '--all', baseSha, headSha],
    'merge-base resolution',
  )
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (ancestors.length !== 1 || !SHA_PATTERN.test(ancestors[0])) {
    throw new ReviewDiffScopeError(
      'DIFF_AMBIGUOUS_ANCESTOR',
      'The reviewed base and HEAD lack exactly one merge base.',
    );
  }
  const mergeBaseSha = ancestors[0];
  const prefix = ['diff', '--no-ext-diff', '--no-textconv'];
  const tail = [mergeBaseSha, headSha, '--'];
  const changedFiles = parseNames(
    git([...prefix, '--name-only', '-z', ...tail], 'filename diff'),
  );
  const stats = parseStats(
    git([...prefix, '--shortstat', ...tail], 'diff statistics'),
    changedFiles.length,
  );

  if (
    resolveSha('HEAD', 'final HEAD verification') !== headSha ||
    resolveSha(baseRef, 'final base verification') !== baseSha
  ) {
    throw new ReviewDiffScopeError(
      'DIFF_SCOPE_CHANGED',
      'HEAD or the base ref changed during the diff; retry review from exploration.',
    );
  }
  return { baseRef, baseSha, headSha, mergeBaseSha, changedFiles, stats };
}

/** A review run cannot silently change its initialized base commit. */
export function assertReviewBaseUnchanged(
  snapshot: ReviewDiffSnapshot,
  recordedBaseSha: string | undefined,
): void {
  if (
    typeof recordedBaseSha !== 'string' ||
    !/^[0-9a-f]{7,64}$/.test(recordedBaseSha) ||
    !snapshot.baseSha.startsWith(recordedBaseSha)
  ) {
    throw new ReviewDiffScopeError(
      'DIFF_BASE_CHANGED',
      'The base commit no longer matches this review run. Start a new review.',
    );
  }
}
