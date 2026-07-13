import { afterEach, describe, expect, test } from 'bun:test';
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

const createdDirectories: string[] = [];
const fullSha = {
  base: '1111111111111111111111111111111111111111',
  head: '2222222222222222222222222222222222222222',
  mergeBase: '3333333333333333333333333333333333333333',
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
  fs.writeFileSync(
    path.join(repositoryRoot, 'tracked-source.txt'),
    'source repository must stay read-only\n',
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

function createFakeGitRunner(options: {
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
      ['merge-base', fullSha.mergeBase],
    ]);

  const runner: FakeGitRunner = {
    executable: '/usr/bin/git',
    invocations: [],
    async run(invocation) {
      runner.invocations.push({
        ...invocation,
        argv: [...invocation.argv],
        env: { ...invocation.env },
      });

      const argv = [...invocation.argv];
      expect(invocation.executable).toBe(runner.executable);
      expect(Array.isArray(argv)).toBe(true);
      expect(invocation.shell).toBe(false);
      expect(invocation.cwd).not.toContain('.git/hooks');
      expect(invocation.env).toEqual({ LANG: 'C', PATH: '/usr/bin:/bin' });

      if (argv.includes('checkout') || argv.includes('fetch')) {
        throw new Error(`mutating git command reached fake runner: ${argv}`);
      }
      if (argv.includes('-c') || argv.includes('--config')) {
        throw new Error(
          `repository-controlled git config reached runner: ${argv}`,
        );
      }

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
        return {
          stdout: Buffer.from(`${commitResolutions.get('merge-base')}\n`),
          stderr: Buffer.alloc(0),
        };
      }

      if (
        argv[0] === 'diff' &&
        argv.includes('--name-only') &&
        argv.includes('-z') &&
        argv.includes('--no-ext-diff') &&
        argv.includes('--no-textconv')
      ) {
        return {
          stdout: Buffer.from(`${changedPaths.join('\0')}\0`),
          stderr: Buffer.alloc(0),
        };
      }

      if (
        argv[0] === 'ls-tree' &&
        argv.includes('-z') &&
        argv.includes('--full-tree')
      ) {
        const requestedPath = argv.at(-1) ?? '';
        const entry = treeEntries.get(requestedPath);
        if (!entry) {
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
        }
        return {
          stdout: Buffer.from(
            `${entry.mode} blob ${entry.objectId}\t${requestedPath}\0`,
          ),
          stderr: Buffer.alloc(0),
        };
      }

      if (argv[0] === 'cat-file' && argv[1] === 'blob') {
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

function assertNoRepositoryMutation(paths: MaterializerTestPaths): void {
  expect(
    fs.readFileSync(
      path.join(paths.repositoryRoot, 'tracked-source.txt'),
      'utf8',
    ),
  ).toBe('source repository must stay read-only\n');
  expect(fs.existsSync(path.join(paths.repositoryRoot, '.git'))).toBe(false);
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
    const git = createFakeGitRunner({});

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

  test('rejects branch tag ref path and option injection before invoking Git', async () => {
    const paths = createPaths();
    const unsafeRefs = [
      'main',
      'refs/tags/v1.0.0',
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
      const git = createFakeGitRunner({});
      const error = await resolveRepositoryTarget(
        paths.repositoryRoot,
        unsafeRef,
        fullSha.head,
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
  });
});

describe('Graphify Git materializer file boundary', () => {
  test('materializes only approved regular Git blobs into the safe staging root without mutating the source repository', async () => {
    const paths = createPaths();
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
    assertNoRepositoryMutation(paths);
  });

  test('fails closed when the changed file set exceeds the configured materialization limit', async () => {
    const paths = createPaths();
    const git = createFakeGitRunner({
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
    assertNoRepositoryMutation(paths);
  });

  test('cleans stale staging contents before producing a deterministic isolated checkout for the same pinned target', async () => {
    const paths = createPaths();
    const treeEntries = new Map<string, TreeEntry>([
      [
        'src/index.ts',
        { mode: '100644', objectId: 'a'.repeat(40), content: 'export {}\n' },
      ],
    ]);
    const git = createFakeGitRunner({
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
    assertNoRepositoryMutation(paths);
  });

  test('rejects unsafe staging roots through assertSafeRoots before any Git command runs', async () => {
    const paths = createPaths();
    const unsafeStagingRoot = path.join(
      paths.repositoryRoot,
      'controlled-staging',
    );
    fs.mkdirSync(unsafeStagingRoot);
    const git = createFakeGitRunner({
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
    assertNoRepositoryMutation(paths);
  });
});
