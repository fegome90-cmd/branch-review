import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  materializeGitFileSet,
  type RepositoryTarget,
  resolveRepositoryTarget,
} from './graphify-materializer.js';
import type { GraphifySafetyPolicy } from './graphify-safety.js';

type GitInvocation = {
  argv: readonly string[];
  cwd: string;
  executable: string;
  env: NodeJS.ProcessEnv;
  shell: false;
};

type FakeGitRunner = {
  readonly executable: string;
  readonly invocations: GitInvocation[];
  run(invocation: GitInvocation): Promise<{ stdout: Buffer; stderr: Buffer }>;
};

type MaterializerTestPaths = {
  sandbox: string;
  repositoryRoot: string;
  runStoreRoot: string;
  stagingRoot: string;
};

type TreeEntry = {
  mode: string;
  objectId: string;
  content?: string;
};

type SourceManifestEntry = {
  type: 'file' | 'directory' | 'symlink';
  relativePath: string;
  mode: number;
  size: number;
  target?: string;
  content?: string;
};

const createdDirectories: string[] = [];
const fullSha = {
  base: '1111111111111111111111111111111111111111',
  head: '2222222222222222222222222222222222222222',
  mergeBase: '3333333333333333333333333333333333333333',
  sha256Base: 'a'.repeat(64),
  sha256Head: 'b'.repeat(64),
  sha256MergeBase: 'c'.repeat(64),
};

function createPaths(): MaterializerTestPaths {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewctl-graphify-materializer-'),
  );
  createdDirectories.push(sandbox);

  const repositoryRoot = path.join(sandbox, 'reviewed repository');
  const runStoreRoot = path.join(sandbox, 'run-store');
  const stagingRoot = path.join(sandbox, 'staging root');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(runStoreRoot);
  fs.mkdirSync(stagingRoot);
  fs.mkdirSync(path.join(repositoryRoot, 'src'));
  fs.writeFileSync(
    path.join(repositoryRoot, 'tracked-source.txt'),
    'source repository must stay read-only\n',
  );
  fs.writeFileSync(
    path.join(repositoryRoot, 'src', 'tracked-nested.txt'),
    'nested source must stay read-only\n',
  );
  fs.symlinkSync(
    'tracked-source.txt',
    path.join(repositoryRoot, 'source-link'),
  );

  return { sandbox, repositoryRoot, runStoreRoot, stagingRoot };
}

function createPolicy(
  paths: MaterializerTestPaths,
  overrides: Partial<GraphifySafetyPolicy> = {},
): GraphifySafetyPolicy {
  return {
    reviewedRepository: paths.repositoryRoot,
    stagingRoot: paths.stagingRoot,
    runStoreRoot: paths.runStoreRoot,
    trustedExecutable: process.execPath,
    allowedEnvironmentKeys: ['PATH', 'LANG'],
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
    networkIsolation: {
      mode: 'disabled',
      evidence: 'test capability',
      assertEnforced: async () => undefined,
    },
    ...overrides,
  };
}

function createTarget(paths: MaterializerTestPaths): RepositoryTarget {
  return {
    repositoryRoot: paths.repositoryRoot,
    baseSha: fullSha.base,
    headSha: fullSha.head,
    mergeBaseSha: fullSha.mergeBase,
  };
}

function runGit(
  repositoryRoot: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): string {
  const gitExecutable = process.env.GIT_EXECUTABLE ?? '/usr/bin/git';
  return execFileSync(gitExecutable, [...argv], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_AUTHOR_NAME: 'Reviewctl Test',
      GIT_AUTHOR_EMAIL: 'reviewctl-test@example.invalid',
      GIT_COMMITTER_NAME: 'Reviewctl Test',
      GIT_COMMITTER_EMAIL: 'reviewctl-test@example.invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
      ...env,
    },
  }).trim();
}

function createRealGitTarget(paths: MaterializerTestPaths): RepositoryTarget {
  const gitExecutable = process.env.GIT_EXECUTABLE ?? '/usr/bin/git';
  runGit(paths.repositoryRoot, ['init', '--initial-branch=main']);
  runGit(paths.repositoryRoot, ['config', 'user.name', 'Reviewctl Test']);
  runGit(paths.repositoryRoot, [
    'config',
    'user.email',
    'reviewctl-test@example.invalid',
  ]);

  fs.writeFileSync(path.join(paths.repositoryRoot, 'tracked-source.txt'), '');
  fs.writeFileSync(
    path.join(paths.repositoryRoot, 'src', 'tracked-nested.txt'),
    '',
  );
  fs.writeFileSync(path.join(paths.repositoryRoot, 'src', 'app.ts'), '');
  runGit(paths.repositoryRoot, [
    'add',
    'tracked-source.txt',
    'source-link',
    'src',
  ]);
  runGit(paths.repositoryRoot, ['commit', '-m', 'base fixture']);
  const baseSha = runGit(paths.repositoryRoot, ['rev-parse', 'HEAD']);

  fs.writeFileSync(
    path.join(paths.repositoryRoot, 'src', 'app.ts'),
    'export const value = 2;\n',
  );
  runGit(paths.repositoryRoot, ['add', 'src/app.ts']);
  runGit(paths.repositoryRoot, ['commit', '-m', 'head fixture'], {
    GIT_AUTHOR_DATE: '2000-01-01T00:00:01Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:01Z',
  });
  const headSha = runGit(paths.repositoryRoot, ['rev-parse', 'HEAD']);
  const mergeBaseSha = runGit(paths.repositoryRoot, [
    'merge-base',
    baseSha,
    headSha,
  ]);

  expect(gitExecutable).toMatch(/git(?:\.exe)?$/u);
  return {
    repositoryRoot: paths.repositoryRoot,
    baseSha,
    headSha,
    mergeBaseSha,
  };
}

function captureSourceManifest(root: string): SourceManifestEntry[] {
  const entries: SourceManifestEntry[] = [];

  function visit(absolutePath: string, relativePath: string): void {
    const stats = fs.lstatSync(absolutePath);
    const base = {
      relativePath,
      mode: stats.mode,
      size: stats.size,
    };

    if (stats.isSymbolicLink()) {
      entries.push({
        ...base,
        type: 'symlink',
        target: fs.readlinkSync(absolutePath),
      });
      return;
    }

    if (stats.isDirectory()) {
      entries.push({ ...base, type: 'directory' });
      for (const child of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, child), path.join(relativePath, child));
      }
      return;
    }

    if (stats.isFile()) {
      entries.push({
        ...base,
        type: 'file',
        content: fs.readFileSync(absolutePath, 'utf8'),
      });
      return;
    }

    throw new Error(`unexpected source manifest entry: ${relativePath}`);
  }

  for (const child of fs.readdirSync(root).sort()) {
    visit(path.join(root, child), child);
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function expectSourceManifestUnchanged(
  paths: MaterializerTestPaths,
  before: SourceManifestEntry[],
): void {
  expect(captureSourceManifest(paths.repositoryRoot)).toEqual(before);
  expect(fs.existsSync(path.join(paths.repositoryRoot, '.git'))).toBe(false);
  expect(fs.existsSync(path.join(paths.repositoryRoot, '.tmp'))).toBe(false);
  expect(fs.existsSync(path.join(paths.repositoryRoot, '.graphify'))).toBe(
    false,
  );
  expect(fs.existsSync(path.join(paths.repositoryRoot, 'tmp'))).toBe(false);
}

function assertCanonicalGitInvocation(
  invocation: GitInvocation,
  expectedArgv: readonly string[],
  repositoryRoot: string,
  executable: string,
): void {
  expect(invocation).toMatchObject({
    executable,
    cwd: repositoryRoot,
    shell: false,
  });
  expect(invocation.argv).toEqual(expectedArgv);
  expect(invocation.env).toEqual({ LANG: 'C', PATH: '/usr/bin:/bin' });
  expect(invocation.cwd).not.toContain('.git/hooks');
  expect(invocation.argv).not.toContain('-c');
  expect(invocation.argv).not.toContain('--config');
  expect(invocation.argv).not.toContain('checkout');
  expect(invocation.argv).not.toContain('fetch');
  expect(invocation.argv).not.toContain('reset');
  expect(invocation.argv).not.toContain('clean');
  expect(invocation.argv).not.toContain('worktree');
  expect(invocation.argv).not.toContain('clone');
  expect(invocation.argv).not.toContain('pull');
  expect(invocation.argv).not.toContain('push');

  const command = invocation.argv[0];
  if (command === 'diff') {
    expect(invocation.argv.at(-1)).toBe('--');
  }
  if (command === 'ls-tree') {
    expect(invocation.argv.at(-2)).toBe('--');
    expect(invocation.argv.at(-1)).not.toBe('');
  }
  if (command === 'cat-file') {
    expect(invocation.argv).toHaveLength(3);
  }
}

function createFakeGitRunner(options: {
  repositoryRoot: string;
  changedPaths?: readonly string[];
  treeEntries?: ReadonlyMap<string, TreeEntry>;
  commitResolutions?: ReadonlyMap<string, string>;
}): FakeGitRunner {
  const changedPaths = options.changedPaths ?? [];
  const treeEntries = options.treeEntries ?? new Map<string, TreeEntry>();
  const commitResolutions =
    options.commitResolutions ??
    new Map<string, string>([
      [fullSha.base, fullSha.base],
      [fullSha.head, fullSha.head],
      [fullSha.sha256Base, fullSha.sha256Base],
      [fullSha.sha256Head, fullSha.sha256Head],
      ['merge-base', fullSha.mergeBase],
      ['sha256-merge-base', fullSha.sha256MergeBase],
    ]);
  const expectedInvocations: readonly string[][] = [
    ['rev-parse', '--verify', '--end-of-options', `${fullSha.base}^{commit}`],
    ['rev-parse', '--verify', '--end-of-options', `${fullSha.head}^{commit}`],
    [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${fullSha.sha256Base}^{commit}`,
    ],
    [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${fullSha.sha256Head}^{commit}`,
    ],
    ['merge-base', fullSha.base, fullSha.head],
    ['merge-base', fullSha.sha256Base, fullSha.sha256Head],
    [
      'diff',
      '--name-only',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      fullSha.base,
      fullSha.head,
      '--',
    ],
    ...[...treeEntries.keys()].flatMap((filePath) => {
      const entry = treeEntries.get(filePath);
      return [
        ['ls-tree', '-z', '--full-tree', fullSha.head, '--', filePath],
        ['cat-file', 'blob', entry?.objectId ?? ''],
      ];
    }),
  ];

  const runner: FakeGitRunner = {
    executable: '/usr/bin/git',
    invocations: [],
    async run(invocation) {
      const copiedInvocation = {
        ...invocation,
        argv: [...invocation.argv],
        env: { ...invocation.env },
      };
      runner.invocations.push(copiedInvocation);

      expect(
        expectedInvocations.some(
          (expected) =>
            JSON.stringify(expected) === JSON.stringify(invocation.argv),
        ),
      ).toBe(true);
      assertCanonicalGitInvocation(
        copiedInvocation,
        copiedInvocation.argv,
        options.repositoryRoot,
        runner.executable,
      );

      const argv = [...invocation.argv];
      if (
        argv[0] === 'rev-parse' &&
        argv[1] === '--verify' &&
        argv[2] === '--end-of-options'
      ) {
        const requested = argv[3]?.replace(/\^\{commit\}$/u, '');
        const sha = requested ? commitResolutions.get(requested) : undefined;
        if (!sha) {
          throw new Error(`unknown commit ref ${requested ?? '<missing>'}`);
        }
        return { stdout: Buffer.from(`${sha}\n`), stderr: Buffer.alloc(0) };
      }

      if (argv[0] === 'merge-base') {
        const sha =
          argv[1] === fullSha.sha256Base
            ? commitResolutions.get('sha256-merge-base')
            : commitResolutions.get('merge-base');
        return { stdout: Buffer.from(`${sha}\n`), stderr: Buffer.alloc(0) };
      }

      if (argv[0] === 'diff') {
        return {
          stdout: Buffer.from(`${changedPaths.join('\0')}\0`),
          stderr: Buffer.alloc(0),
        };
      }

      if (argv[0] === 'ls-tree') {
        const separatorIndex = argv.lastIndexOf('--');
        const requestedPath = argv[separatorIndex + 1] ?? '';
        const entry = treeEntries.get(requestedPath);
        if (!entry) {
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
        }
        return {
          stdout: Buffer.from(
            `${entry.mode} blob ${entry.objectId}	${requestedPath}\0`,
          ),
          stderr: Buffer.alloc(0),
        };
      }

      if (argv[0] === 'cat-file') {
        const objectId = argv[2] ?? '';
        const entry = [...treeEntries.values()].find(
          (candidate) => candidate.objectId === objectId,
        );
        return {
          stdout: Buffer.from(entry?.content ?? ''),
          stderr: Buffer.alloc(0),
        };
      }

      throw new Error(`unexpected git argv: ${argv.join(' ')}`);
    },
  };

  return runner;
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('Graphify Git materializer target resolution', () => {
  test('resolves only pinned full commit identities and merge-base through argv-based read-only Git', async () => {
    const paths = createPaths();
    const git = createFakeGitRunner({ repositoryRoot: paths.repositoryRoot });

    const target = await resolveRepositoryTarget(
      paths.repositoryRoot,
      fullSha.base,
      fullSha.head,
      { git, policy: createPolicy(paths) },
    );

    expect(target).toEqual({
      repositoryRoot: paths.repositoryRoot,
      baseSha: fullSha.base,
      headSha: fullSha.head,
      mergeBaseSha: fullSha.mergeBase,
    });
    expect(git.invocations.map((invocation) => invocation.argv)).toEqual([
      ['rev-parse', '--verify', '--end-of-options', `${fullSha.base}^{commit}`],
      ['rev-parse', '--verify', '--end-of-options', `${fullSha.head}^{commit}`],
      ['merge-base', fullSha.base, fullSha.head],
    ]);
  });

  test('accepts sha256 repositories only when pins are exactly 64 hexadecimal characters', async () => {
    const paths = createPaths();
    const git = createFakeGitRunner({ repositoryRoot: paths.repositoryRoot });

    const target = await resolveRepositoryTarget(
      paths.repositoryRoot,
      fullSha.sha256Base,
      fullSha.sha256Head,
      { git, policy: createPolicy(paths) },
    );

    expect(target).toEqual({
      repositoryRoot: paths.repositoryRoot,
      baseSha: fullSha.sha256Base,
      headSha: fullSha.sha256Head,
      mergeBaseSha: fullSha.sha256MergeBase,
    });
    expect(git.invocations.map((invocation) => invocation.argv)).toEqual([
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${fullSha.sha256Base}^{commit}`,
      ],
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${fullSha.sha256Head}^{commit}`,
      ],
      ['merge-base', fullSha.sha256Base, fullSha.sha256Head],
    ]);
  });

  test('rejects every non-immutable or malformed base or head commit pin before invoking Git', async () => {
    const paths = createPaths();
    const unsafeRefs = [
      '',
      ' ',
      fullSha.base.slice(0, 7),
      fullSha.base.slice(0, 39),
      `${fullSha.base}0`,
      'g'.repeat(40),
      'z'.repeat(64),
      'main',
      'HEAD',
      'refs/tags/v1.0.0',
      'refs/heads/main',
      'feature/branch',
      '../HEAD',
      '/absolute/ref',
      '--upload-pack=/tmp/evil',
      '-c core.sshCommand=evil',
      'HEAD; touch /tmp/evil',
      'HEAD\nrefs/heads/main',
      `${fullSha.base} --help`,
    ];

    for (const unsafeRef of unsafeRefs) {
      for (const candidate of [
        { baseSha: unsafeRef, headSha: fullSha.head },
        { baseSha: fullSha.base, headSha: unsafeRef },
      ]) {
        const git = createFakeGitRunner({
          repositoryRoot: paths.repositoryRoot,
        });
        const error = await resolveRepositoryTarget(
          paths.repositoryRoot,
          candidate.baseSha,
          candidate.headSha,
          { git, policy: createPolicy(paths) },
        ).catch((caughtError: unknown) => caughtError);

        expect(error).toMatchObject({
          code: 'INVALID_GIT_REF',
          diagnostics: expect.any(String),
        });
        expect(git.invocations).toHaveLength(0);
        expect(JSON.stringify(error)).not.toContain(paths.repositoryRoot);
        expect(JSON.stringify(error)).not.toContain(paths.stagingRoot);
      }
    }
  });

  test('rejects malformed resolved base or head commit output from Git instead of trusting it', async () => {
    const paths = createPaths();
    const malformedResolvedOutputs = [
      fullSha.base.slice(0, 39),
      `${fullSha.base}0`,
      'g'.repeat(40),
      'refs/heads/main',
      `${fullSha.base}\n${fullSha.head}`,
      '',
    ];

    for (const malformedOutput of malformedResolvedOutputs) {
      for (const commitResolutions of [
        new Map<string, string>([
          [fullSha.base, malformedOutput],
          [fullSha.head, fullSha.head],
          ['merge-base', fullSha.mergeBase],
        ]),
        new Map<string, string>([
          [fullSha.base, fullSha.base],
          [fullSha.head, malformedOutput],
          ['merge-base', fullSha.mergeBase],
        ]),
      ]) {
        const git = createFakeGitRunner({
          repositoryRoot: paths.repositoryRoot,
          commitResolutions,
        });

        const error = await resolveRepositoryTarget(
          paths.repositoryRoot,
          fullSha.base,
          fullSha.head,
          { git, policy: createPolicy(paths) },
        ).catch((caughtError: unknown) => caughtError);

        expect(error).toMatchObject({
          code: 'INVALID_GIT_REF',
          diagnostics: expect.any(String),
        });
        expect(JSON.stringify(error)).not.toContain(paths.repositoryRoot);
      }
    }
  });

  test('rejects malformed merge-base output from Git instead of trusting it', async () => {
    const paths = createPaths();
    const malformedMergeBaseOutputs = [
      fullSha.mergeBase.slice(0, 39),
      `${fullSha.mergeBase}0`,
      'g'.repeat(40),
      'refs/heads/main',
      `${fullSha.mergeBase}\n${fullSha.head}`,
      '',
    ];

    for (const malformedOutput of malformedMergeBaseOutputs) {
      const git = createFakeGitRunner({
        repositoryRoot: paths.repositoryRoot,
        commitResolutions: new Map<string, string>([
          [fullSha.base, fullSha.base],
          [fullSha.head, fullSha.head],
          ['merge-base', malformedOutput],
        ]),
      });

      const error = await resolveRepositoryTarget(
        paths.repositoryRoot,
        fullSha.base,
        fullSha.head,
        { git, policy: createPolicy(paths) },
      ).catch((caughtError: unknown) => caughtError);

      expect(error).toMatchObject({
        code: 'INVALID_GIT_REF',
        diagnostics: expect.any(String),
      });
      expect(JSON.stringify(error)).not.toContain(paths.repositoryRoot);
    }
  });
});

describe('Graphify Git materializer file boundary', () => {
  test('materializes only approved regular Git blobs into the safe staging root without mutating the source repository', async () => {
    const paths = createPaths();
    const sourceManifestBefore = captureSourceManifest(paths.repositoryRoot);
    const treeEntries = new Map<string, TreeEntry>([
      [
        'safe file.txt',
        { mode: '100644', objectId: 'a'.repeat(40), content: 'safe\n' },
      ],
      [
        'tabs\tname.txt',
        { mode: '100644', objectId: 'b'.repeat(40), content: 'tabs\n' },
      ],
      [
        'new\nline.txt',
        { mode: '100644', objectId: 'c'.repeat(40), content: 'newline\n' },
      ],
      [
        'unicodé-雪.txt',
        { mode: '100644', objectId: 'd'.repeat(40), content: 'unicode\n' },
      ],
      [
        '--leading-dash.txt',
        { mode: '100644', objectId: 'e'.repeat(40), content: 'dash\n' },
      ],
      [
        '../escape.txt',
        { mode: '100644', objectId: 'f'.repeat(40), content: 'escape\n' },
      ],
      [
        '/absolute.txt',
        { mode: '100644', objectId: '1'.repeat(40), content: 'absolute\n' },
      ],
      [
        'dir/link',
        { mode: '120000', objectId: '2'.repeat(40), content: '../outside\n' },
      ],
      ['vendor/submodule', { mode: '160000', objectId: '3'.repeat(40) }],
      ['special/fifo', { mode: '100664', objectId: '4'.repeat(40) }],
    ]);
    const git = createFakeGitRunner({
      repositoryRoot: paths.repositoryRoot,
      changedPaths: [...treeEntries.keys()],
      treeEntries,
    });

    const result = await materializeGitFileSet(
      createTarget(paths),
      createPolicy(paths),
      {
        git,
        approvedPaths: [
          'safe file.txt',
          'tabs\tname.txt',
          'new\nline.txt',
          'unicodé-雪.txt',
          '--leading-dash.txt',
          '../escape.txt',
          '/absolute.txt',
          'dir/link',
          'vendor/submodule',
          'special/fifo',
        ],
        maxFiles: 20,
      },
    );

    expect(result.stagingRoot).toBe(path.resolve(paths.stagingRoot));
    expect(result.includedFiles).toEqual([
      '--leading-dash.txt',
      'new\nline.txt',
      'safe file.txt',
      'tabs\tname.txt',
      'unicodé-雪.txt',
    ]);
    expect(
      result.skippedFiles.map(
        (entry: { path: string; reason: string }) => entry.reason,
      ),
    ).toEqual([
      'absolute_path',
      'path_traversal',
      'unsupported_git_mode',
      'unsupported_git_mode',
      'unsupported_git_mode',
    ]);
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'safe file.txt'), 'utf8'),
    ).toBe('safe\n');
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'tabs\tname.txt'), 'utf8'),
    ).toBe('tabs\n');
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'new\nline.txt'), 'utf8'),
    ).toBe('newline\n');
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'unicodé-雪.txt'), 'utf8'),
    ).toBe('unicode\n');
    expect(
      fs.readFileSync(
        path.join(paths.stagingRoot, '--leading-dash.txt'),
        'utf8',
      ),
    ).toBe('dash\n');
    expect(fs.existsSync(path.join(paths.sandbox, 'escape.txt'))).toBe(false);
    expectSourceManifestUnchanged(paths, sourceManifestBefore);

    const invocations = git.invocations.map((invocation) => invocation.argv);
    expect(invocations[0]).toEqual([
      'diff',
      '--name-only',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      fullSha.base,
      fullSha.head,
      '--',
    ]);

    const lsTreePaths = invocations
      .filter((argv) => argv[0] === 'ls-tree')
      .map((argv) => argv.at(-1));
    const catFileObjectIds = invocations
      .filter((argv) => argv[0] === 'cat-file')
      .map((argv) => argv[2]);

    for (const filePath of [
      'safe file.txt',
      'tabs\tname.txt',
      'new\nline.txt',
      'unicodé-雪.txt',
      '--leading-dash.txt',
    ]) {
      const expectedObjectId = treeEntries.get(filePath)?.objectId;
      if (!expectedObjectId) {
        throw new Error(`Missing test fixture object id for ${filePath}`);
      }
      expect(lsTreePaths).toContain(filePath);
      expect(catFileObjectIds).toContain(expectedObjectId);
    }

    for (const unsupportedPath of [
      'dir/link',
      'vendor/submodule',
      'special/fifo',
    ]) {
      expect(lsTreePaths).toContain(unsupportedPath);
      expect(catFileObjectIds).not.toContain(
        treeEntries.get(unsupportedPath)?.objectId,
      );
    }

    for (const unsafePath of ['../escape.txt', '/absolute.txt']) {
      expect(catFileObjectIds).not.toContain(
        treeEntries.get(unsafePath)?.objectId,
      );
    }
  });

  test('fails closed when Git reports a changed path outside the approved path set', async () => {
    const paths = createPaths();
    const sourceManifestBefore = captureSourceManifest(paths.repositoryRoot);
    const approvedFixturePath = 'approved/safe.ts';
    const unapprovedFixturePath = 'unapproved/secret.ts';
    const git = createFakeGitRunner({
      repositoryRoot: paths.repositoryRoot,
      changedPaths: [approvedFixturePath, unapprovedFixturePath],
      treeEntries: new Map<string, TreeEntry>([
        [
          approvedFixturePath,
          { mode: '100644', objectId: 'a'.repeat(40), content: 'safe\n' },
        ],
        [
          unapprovedFixturePath,
          { mode: '100644', objectId: 'b'.repeat(40), content: 'secret\n' },
        ],
      ]),
    });

    const error = await materializeGitFileSet(
      createTarget(paths),
      createPolicy(paths),
      { git, approvedPaths: [approvedFixturePath], maxFiles: 10 },
    ).catch((caughtError: unknown) => caughtError);

    expect(error).toMatchObject({
      code: 'UNAPPROVED_CHANGED_PATH',
      diagnostics: expect.any(String),
    });
    expect(JSON.stringify(error)).toContain(unapprovedFixturePath);
    expect(JSON.stringify(error)).not.toContain(paths.repositoryRoot);
    expect(git.invocations.map((invocation) => invocation.argv)).toEqual([
      [
        'diff',
        '--name-only',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        fullSha.base,
        fullSha.head,
        '--',
      ],
    ]);
    expect(
      git.invocations.some((invocation) =>
        invocation.argv.includes(unapprovedFixturePath),
      ),
    ).toBe(false);
    expect(
      git.invocations.some((invocation) => invocation.argv[0] === 'cat-file'),
    ).toBe(false);
    expect(fs.readdirSync(paths.stagingRoot)).toEqual([]);
    expectSourceManifestUnchanged(paths, sourceManifestBefore);
  });

  test('fails closed when the changed file set exceeds the configured materialization limit', async () => {
    const paths = createPaths();
    const sourceManifestBefore = captureSourceManifest(paths.repositoryRoot);
    const git = createFakeGitRunner({
      repositoryRoot: paths.repositoryRoot,
      changedPaths: ['one.txt', 'two.txt', 'three.txt'],
      treeEntries: new Map<string, TreeEntry>([
        [
          'one.txt',
          { mode: '100644', objectId: 'a'.repeat(40), content: 'one\n' },
        ],
        [
          'two.txt',
          { mode: '100644', objectId: 'b'.repeat(40), content: 'two\n' },
        ],
        [
          'three.txt',
          { mode: '100644', objectId: 'c'.repeat(40), content: 'three\n' },
        ],
      ]),
    });

    const error = await materializeGitFileSet(
      createTarget(paths),
      createPolicy(paths),
      {
        git,
        approvedPaths: ['one.txt', 'two.txt', 'three.txt'],
        maxFiles: 2,
      },
    ).catch((caughtError: unknown) => caughtError);

    expect(error).toMatchObject({
      code: 'MATERIALIZATION_LIMIT_EXCEEDED',
      diagnostics: expect.any(String),
    });
    expect(fs.readdirSync(paths.stagingRoot)).toEqual([]);
    expect(JSON.stringify(error)).not.toContain(paths.repositoryRoot);
    expectSourceManifestUnchanged(paths, sourceManifestBefore);
  });

  test('cleans stale staging contents before producing a deterministic isolated checkout for the same pinned target', async () => {
    const paths = createPaths();
    const sourceManifestBefore = captureSourceManifest(paths.repositoryRoot);
    const treeEntries = new Map<string, TreeEntry>([
      [
        'src/index.ts',
        { mode: '100644', objectId: 'a'.repeat(40), content: 'export {}\n' },
      ],
    ]);
    const git = createFakeGitRunner({
      repositoryRoot: paths.repositoryRoot,
      changedPaths: ['src/index.ts'],
      treeEntries,
    });
    fs.mkdirSync(path.join(paths.stagingRoot, 'stale'), { recursive: true });
    fs.writeFileSync(path.join(paths.stagingRoot, 'stale', 'old.txt'), 'old\n');

    const first = await materializeGitFileSet(
      createTarget(paths),
      createPolicy(paths),
      {
        git,
        approvedPaths: ['src/index.ts'],
        maxFiles: 10,
      },
    );
    fs.writeFileSync(
      path.join(paths.stagingRoot, 'extra.txt'),
      'must be removed\n',
    );
    const second = await materializeGitFileSet(
      createTarget(paths),
      createPolicy(paths),
      {
        git,
        approvedPaths: ['src/index.ts'],
        maxFiles: 10,
      },
    );

    expect(first).toEqual(second);
    expect(fs.existsSync(path.join(paths.stagingRoot, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(paths.stagingRoot, 'extra.txt'))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'src', 'index.ts'), 'utf8'),
    ).toBe('export {}\n');
    expectSourceManifestUnchanged(paths, sourceManifestBefore);
  });

  test('rejects unsafe staging roots through assertSafeRoots before any Git command runs', async () => {
    const paths = createPaths();
    const sourceManifestBefore = captureSourceManifest(paths.repositoryRoot);
    const unsafeStagingRoot = path.join(
      paths.repositoryRoot,
      'controlled-staging',
    );
    fs.mkdirSync(unsafeStagingRoot);
    const git = createFakeGitRunner({
      repositoryRoot: paths.repositoryRoot,
      changedPaths: ['safe.txt'],
      treeEntries: new Map<string, TreeEntry>([
        [
          'safe.txt',
          { mode: '100644', objectId: 'a'.repeat(40), content: 'safe\n' },
        ],
      ]),
    });

    await expect(
      materializeGitFileSet(
        createTarget(paths),
        createPolicy(paths, { stagingRoot: unsafeStagingRoot }),
        { git, approvedPaths: ['safe.txt'], maxFiles: 10 },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ROOT',
    });
    expect(git.invocations).toHaveLength(0);
    expectSourceManifestUnchanged(paths, sourceManifestBefore);
  });

  test('supports the planned public materializer invocation without requiring test-only seams', async () => {
    const paths = createPaths();
    const target = createRealGitTarget(paths);

    const result = await materializeGitFileSet(
      target,
      createPolicy(paths, {
        trustedExecutable: process.env.GIT_EXECUTABLE ?? '/usr/bin/git',
      }),
      {
        approvedPaths: ['src/app.ts'],
        maxFiles: 10,
      },
    );

    expect(result).toEqual({
      stagingRoot: path.resolve(paths.stagingRoot),
      includedFiles: ['src/app.ts'],
      skippedFiles: [],
    });
    expect(
      fs.readFileSync(path.join(paths.stagingRoot, 'src', 'app.ts'), 'utf8'),
    ).toBe('export const value = 2;\n');
    expect(runGit(paths.repositoryRoot, ['status', '--short'])).toBe('');
  });
});
