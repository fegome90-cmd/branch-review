import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGraphifySafety } from './graphify-safety.js';

type SafetyPaths = {
  sandbox: string;
  reviewedRepository: string;
  runStoreRoot: string;
  stagingCwd: string;
};

type RunnerRequest = {
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  shell: false;
  timeoutMs?: number;
};

type RunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type StartedProcess = {
  pid: number;
  completion: Promise<RunnerResult>;
};

type StartProcess = (request: RunnerRequest) => StartedProcess;

type BoundaryOverrides = {
  runStoreRoot?: string;
  reviewedRepository?: string;
  stagingCwd?: string;
  trustedExecutables?: string[];
  environment?: Record<string, string>;
  startProcess?: StartProcess;
  hasNetworkIsolation?: () => boolean;
  terminateProcessGroup?: (pid: number) => void;
};

const createdDirectories: string[] = [];

function createSafetyPaths(): SafetyPaths {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewctl-graphify-safety-'),
  );
  createdDirectories.push(sandbox);

  const reviewedRepository = path.join(sandbox, 'reviewed-repository');
  const runStoreRoot = path.join(sandbox, 'run-store');
  const stagingCwd = path.join(sandbox, 'staging');
  fs.mkdirSync(reviewedRepository);
  fs.mkdirSync(runStoreRoot);
  fs.mkdirSync(stagingCwd);

  return { sandbox, reviewedRepository, runStoreRoot, stagingCwd };
}

function createBoundary(
  paths: SafetyPaths,
  overrides: BoundaryOverrides = {},
) {
  const startedRequests: RunnerRequest[] = [];
  let nextPid = 4100;
  const startProcess: StartProcess =
    overrides.startProcess ??
    ((request) => {
      startedRequests.push(request);
      return {
        pid: nextPid++,
        completion: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      };
    });

  const boundary = createGraphifySafety({
    runStoreRoot: overrides.runStoreRoot ?? paths.runStoreRoot,
    reviewedRepository:
      overrides.reviewedRepository ?? paths.reviewedRepository,
    stagingCwd: overrides.stagingCwd ?? paths.stagingCwd,
    trustedExecutables: overrides.trustedExecutables ?? [process.execPath],
    dependencies: {
      startProcess,
      getEnvironment: () =>
        overrides.environment ?? {
          PATH: '/usr/bin',
          LANG: 'C',
        },
      hasNetworkIsolation: overrides.hasNetworkIsolation ?? (() => true),
      terminateProcessGroup:
        overrides.terminateProcessGroup ?? (() => undefined),
    },
  });

  return { boundary, startedRequests };
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('Graphify safety path policy', () => {
  test('rejects a relative RunStore root', () => {
    const paths = createSafetyPaths();

    expect(() =>
      createBoundary(paths, { runStoreRoot: 'relative-run-store' }),
    ).toThrow(/absolute/i);
  });

  test('rejects a RunStore contained by the reviewed repository', () => {
    const paths = createSafetyPaths();
    const nestedRunStore = path.join(paths.reviewedRepository, 'run-store');
    fs.mkdirSync(nestedRunStore);

    expect(() =>
      createBoundary(paths, { runStoreRoot: nestedRunStore }),
    ).toThrow(/contain|overlap|distinct/i);
  });

  test('rejects a reviewed repository contained by the RunStore', () => {
    const paths = createSafetyPaths();
    const nestedRepository = path.join(paths.runStoreRoot, 'reviewed');
    fs.mkdirSync(nestedRepository);

    expect(() =>
      createBoundary(paths, { reviewedRepository: nestedRepository }),
    ).toThrow(/contain|overlap|distinct/i);
  });

  test('rejects a symlink escape from the reviewed repository', () => {
    const paths = createSafetyPaths();
    const escapedTarget = path.join(paths.sandbox, 'escaped-run-store');
    const escapedPath = path.join(
      paths.reviewedRepository,
      'run-store-symlink',
    );
    fs.mkdirSync(escapedTarget);
    fs.symlinkSync(escapedTarget, escapedPath, 'dir');

    expect(() =>
      createBoundary(paths, { runStoreRoot: escapedPath }),
    ).toThrow(/symlink|escape|realpath|contain/i);
  });

  test('accepts distinct absolute realpaths', () => {
    const paths = createSafetyPaths();

    expect(() => createBoundary(paths)).not.toThrow();
  });
});

describe('Graphify trusted execution contract', () => {
  test('requires an absolute trusted executable', async () => {
    const paths = createSafetyPaths();
    const { boundary } = createBoundary(paths);

    await expect(
      boundary.runTrusted({ executable: 'graphify', argv: [] }),
    ).rejects.toThrow(/absolute/i);
  });

  test('rejects an executable outside the trusted allowlist', async () => {
    const paths = createSafetyPaths();
    const { boundary } = createBoundary(paths);
    const untrustedExecutable = path.join(paths.sandbox, 'untrusted');

    await expect(
      boundary.runTrusted({ executable: untrustedExecutable, argv: [] }),
    ).rejects.toThrow(/allowlist|trusted/i);
  });

  test('rejects repository configuration that selects executable or plugin paths', async () => {
    const paths = createSafetyPaths();
    const { boundary } = createBoundary(paths);

    await expect(
      boundary.runTrusted({
        executable: process.execPath,
        argv: [],
        repositoryConfig: {
          executablePath: '/tmp/repository-selected-executable',
          pluginPath: '/tmp/repository-selected-plugin',
        },
      }),
    ).rejects.toThrow(/repository configuration|executable|plugin/i);
  });

  test('uses a fixed staging cwd and never the reviewed repository', async () => {
    const paths = createSafetyPaths();
    const { boundary, startedRequests } = createBoundary(paths);

    await boundary.runTrusted({ executable: process.execPath, argv: [] });

    expect(startedRequests[0]?.cwd).toBe(paths.stagingCwd);
    expect(startedRequests[0]?.cwd).not.toBe(paths.reviewedRepository);
  });

  test('passes only the minimal allowlisted environment', async () => {
    const paths = createSafetyPaths();
    const { boundary, startedRequests } = createBoundary(paths, {
      environment: {
        PATH: '/usr/bin',
        LANG: 'C',
        REVIEW_API_TOKEN: 'review-secret',
        GITHUB_TOKEN: 'github-secret',
        GH_TOKEN: 'gh-secret',
        AWS_ACCESS_KEY_ID: 'provider-access-key',
        AWS_SECRET_ACCESS_KEY: 'provider-secret-key',
        ANTHROPIC_API_KEY: 'provider-api-key',
        UNRELATED_SECRET: 'unrelated-secret',
      },
    });

    await boundary.runTrusted({ executable: process.execPath, argv: [] });

    expect(startedRequests[0]?.env).toEqual({ PATH: '/usr/bin', LANG: 'C' });
  });

  test('preserves spaces, tabs, newlines, Unicode, and leading dashes in argv', async () => {
    const paths = createSafetyPaths();
    const { boundary, startedRequests } = createBoundary(paths);
    const argv = [
      'value with spaces',
      'value\twith\ttabs',
      'value\nwith\nnewlines',
      'unicodé-雪-🛡️',
      '--leading-dash',
    ];

    await boundary.runTrusted({ executable: process.execPath, argv });

    expect(startedRequests[0]?.argv).toEqual(argv);
  });

  test('disables the shell', async () => {
    const paths = createSafetyPaths();
    const { boundary, startedRequests } = createBoundary(paths);

    await boundary.runTrusted({ executable: process.execPath, argv: [] });

    expect(startedRequests[0]?.shell).toBe(false);
  });

  test('fails closed when stdout or stderr exceeds the configured limits', async () => {
    const oversizedOutput = 'x'.repeat(1024 * 1024);
    for (const output of [
      { stdout: oversizedOutput, stderr: '' },
      { stdout: '', stderr: oversizedOutput },
    ]) {
      const paths = createSafetyPaths();
      const { boundary } = createBoundary(paths, {
        startProcess: () => ({
          pid: 4201,
          completion: Promise.resolve({
            exitCode: 0,
            ...output,
          }),
        }),
      });

      await expect(
        boundary.runTrusted({ executable: process.execPath, argv: [] }),
      ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    }
  });

  test('terminates the process group on timeout and returns sanitized diagnostics', async () => {
    const paths = createSafetyPaths();
    const neverCompletes = new Promise<RunnerResult>(() => undefined);
    let terminatedPid: number | undefined;
    const { boundary } = createBoundary(paths, {
      environment: {
        PATH: '/usr/bin',
        REVIEW_API_TOKEN: 'must-not-appear-in-diagnostics',
      },
      startProcess: () => ({ pid: 4202, completion: neverCompletes }),
      terminateProcessGroup: (pid) => {
        terminatedPid = pid;
      },
    });

    const error = await boundary
      .runTrusted({ executable: process.execPath, argv: [], timeoutMs: 25 })
      .catch((caughtError: unknown) => caughtError);

    expect(terminatedPid).toBe(4202);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect(String(error)).not.toContain('must-not-appear-in-diagnostics');
  });

  test('fails closed when network isolation is unavailable', async () => {
    const paths = createSafetyPaths();
    let started = false;
    const { boundary } = createBoundary(paths, {
      hasNetworkIsolation: () => false,
      startProcess: () => {
        started = true;
        return {
          pid: 4203,
          completion: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
        };
      },
    });

    await expect(
      boundary.runTrusted({ executable: process.execPath, argv: [] }),
    ).rejects.toMatchObject({ code: 'NETWORK_ISOLATION_UNAVAILABLE' });
    expect(started).toBe(false);
  });
});
