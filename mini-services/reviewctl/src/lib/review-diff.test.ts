import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReviewBaseUnchanged,
  getReviewDiffSnapshot,
} from './review-diff.js';

const originalCwd = process.cwd();
const dirs: string[] = [];

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-diff-'));
  dirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'synthetic@example.invalid');
  git(dir, 'config', 'user.name', 'Synthetic Review');
  git(dir, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# root\n');
  git(dir, 'add', '.');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  const baseSha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'switch', '-qc', 'review/feature');
  return { dir, baseSha };
}

function commitFile(dir: string, filename: string, body = 'added\n') {
  const absolute = path.join(dir, filename);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body);
  git(dir, 'add', '-A');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'feature');
}

function scoped<T>(dir: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function runWithFakeGit(dir: string, scriptLines: string[]) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-git-shim-'));
  dirs.push(bin);
  const shimPath = path.join(bin, 'git');
  fs.writeFileSync(shimPath, ['#!/bin/sh', ...scriptLines].join('\n') + '\n', {
    mode: 0o755,
  });
  const realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  const script =
    'import { getReviewDiffSnapshot } from ' +
    JSON.stringify(fileURLToPath(new URL('./review-diff.ts', import.meta.url))) +
    '; try { getReviewDiffSnapshot("main"); process.exit(0); } catch (e) {' +
    ' console.error(String(e)); process.exit(2); }';
  return spawnSync('bun', ['-e', script], {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      REAL_GIT: realGit,
      PATH: bin + path.delimiter + process.env.PATH,
    },
  });
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const directory of dirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Git diff scope: deterministic and fail closed', () => {
  test('T01: includes all commits, not only HEAD~1', () => {
    const f = makeRepo();
    commitFile(f.dir, 'first.ts');
    commitFile(f.dir, 'second.ts');
    const snapshot = scoped(f.dir, () => getReviewDiffSnapshot('main'));
    expect(snapshot.changedFiles.sort()).toEqual(['first.ts', 'second.ts']);
    expect(snapshot.stats).toEqual({ files: 2, added: 2, removed: 0 });
    expect(snapshot.mergeBaseSha).toBe(f.baseSha);
  });

  test('T02: missing local base fails instead of shrinking the diff', () => {
    const f = makeRepo();
    commitFile(f.dir, 'first.ts');
    commitFile(f.dir, 'second.ts');
    git(f.dir, 'branch', '-D', 'main');
    expect(() => scoped(f.dir, () => getReviewDiffSnapshot('main'))).toThrow(
      /DIFF_GIT_FAILED/,
    );
  });

  test('T03: unrelated histories never fall back to HEAD~1', () => {
    const f = makeRepo();
    git(f.dir, 'checkout', '--orphan', 'review/independent');
    git(f.dir, 'rm', '-rf', '.');
    commitFile(f.dir, 'first-independent.ts');
    commitFile(f.dir, 'second-independent.ts');
    expect(() => scoped(f.dir, () => getReviewDiffSnapshot('main'))).toThrow(
      /DIFF_GIT_FAILED/,
    );
  });

  test('T04: respects explicit release base, not default main', () => {
    const f = makeRepo();
    git(f.dir, 'switch', 'main');
    git(f.dir, 'switch', '-c', 'release/1.0');
    commitFile(f.dir, 'release.ts');
    git(f.dir, 'switch', '-c', 'review/release-fix');
    commitFile(f.dir, 'fix.ts');
    const snapshot = scoped(f.dir, () => getReviewDiffSnapshot('release/1.0'));
    expect(snapshot.changedFiles).toEqual(['fix.ts']);
    expect(scoped(f.dir, () => getReviewDiffSnapshot('main')).changedFiles).toEqual(
      ['fix.ts', 'release.ts'],
    );
  });

  test('T05: a valid empty diff is success with exact zeros', () => {
    const f = makeRepo();
    const snapshot = scoped(f.dir, () => getReviewDiffSnapshot('main'));
    expect(snapshot.changedFiles).toEqual([]);
    expect(snapshot.stats).toEqual({ files: 0, added: 0, removed: 0 });
  });

  test('T06: preserves Unicode, spaces and newlines in filenames', () => {
    const f = makeRepo();
    const filename = 'src/mañana with spaces\nnotes.ts';
    commitFile(f.dir, filename);
    const snapshot = scoped(f.dir, () => getReviewDiffSnapshot('main'));
    expect(snapshot.changedFiles).toEqual([filename]);
    expect(snapshot.stats.files).toBe(1);
  });

  test('T07: malformed git shortstat cannot be counted as 0', () => {
    const f = makeRepo();
    commitFile(f.dir, 'feature.ts');
    const child = runWithFakeGit(f.dir, [
      'case " $* " in',
      '  *" --shortstat "*) printf "unexpected statistics\\n"; exit 0 ;;',
      'esac',
      'exec "$REAL_GIT" "$@"',
    ]);
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('DIFF_INVALID_STATS');
  });

  test('T08: rejects shallow local history without autofetch', () => {
    const f = makeRepo();
    commitFile(f.dir, 'feature.ts');
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewctl-shallow-'));
    dirs.push(clone);
    execFileSync('git', [
      'clone', '-q', '--depth=1', '--no-local', '--branch', 'review/feature',
      'file://' + f.dir, clone,
    ]);
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(() => scoped(clone, () => getReviewDiffSnapshot('review/feature'))).toThrow(
      /DIFF_INCOMPLETE_HISTORY/,
    );
  });

  test('T09: rejects ambiguous criss-cross merge bases', () => {
    const f = makeRepo();
    const tree = git(f.dir, 'rev-parse', 'HEAD^{tree}');
    const left = git(f.dir, 'commit-tree', tree, '-p', f.baseSha, '-m', 'left');
    const right = git(f.dir, 'commit-tree', tree, '-p', f.baseSha, '-m', 'right');
    const mergeLeft = git(
      f.dir, 'commit-tree', tree, '-p', left, '-p', right, '-m', 'merge left',
    );
    const mergeRight = git(
      f.dir, 'commit-tree', tree, '-p', right, '-p', left, '-m', 'merge right',
    );
    git(f.dir, 'branch', '-f', 'main', mergeLeft);
    git(f.dir, 'update-ref', 'refs/heads/review/feature', mergeRight);
    const bases = git(f.dir, 'merge-base', '--all', mergeLeft, mergeRight);
    expect(bases.split('\n')).toHaveLength(2);
    expect(() => scoped(f.dir, () => getReviewDiffSnapshot('main'))).toThrow(
      /DIFF_AMBIGUOUS_ANCESTOR/,
    );
  });

  test('T10: detects HEAD changed during diff capture', () => {
    const f = makeRepo();
    commitFile(f.dir, 'feature.ts');
    const child = runWithFakeGit(f.dir, [
      'case " $* " in',
      '  *" --shortstat "*)',
      '    "$REAL_GIT" -c commit.gpgsign=false commit --allow-empty -qm "moving head"',
      '    ;;',
      'esac',
      'exec "$REAL_GIT" "$@"',
    ]);
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('DIFF_SCOPE_CHANGED');
  });

  test('does not accept a base ref moved after init', () => {
    const f = makeRepo();
    commitFile(f.dir, 'feature.ts');
    const snap = scoped(f.dir, () => getReviewDiffSnapshot('main'));
    expect(() => assertReviewBaseUnchanged(snap, f.baseSha)).not.toThrow();
    expect(() =>
      assertReviewBaseUnchanged(snap, 'c'.repeat(40)),
    ).toThrow(/DIFF_BASE_CHANGED/);
  });

  test('cannot interpret a shell payload as a Git reference', () => {
    const f = makeRepo();
    expect(() =>
      scoped(f.dir, () => getReviewDiffSnapshot('main;touch hacked')),
    ).toThrow(/DIFF_INVALID_BASE/);
  });
});
