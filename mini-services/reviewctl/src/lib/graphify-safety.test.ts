import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafeRoots,
  createMinimalEnvironment,
  runTrustedProcess,
  type GraphifySafetyPolicy,
} from './graphify-safety.js';

type SafetyPaths = {
  sandbox: string;
  reviewedRepository: string;
  runStoreRoot: string;
  stagingRoot: string;
};

const createdDirectories: string[] = [];

function createSafetyPaths(): SafetyPaths {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), 'reviewctl-graphify-safety-'),
  );
  createdDirectories.push(sandbox);

  const reviewedRepository = path.join(sandbox, 'reviewed-repository');
  const runStoreRoot = path.join(sandbox, 'run-store');
  const stagingRoot = path.join(sandbox, 'staging');
  fs.mkdirSync(reviewedRepository);
  fs.mkdirSync(runStoreRoot);
  fs.mkdirSync(stagingRoot);

  return { sandbox, reviewedRepository, runStoreRoot, stagingRoot };
}

function createPolicy(
  paths: SafetyPaths,
  overrides: Partial<GraphifySafetyPolicy> = {},
): GraphifySafetyPolicy {
  return {
    reviewedRepository: paths.reviewedRepository,
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

function nodeArgv(script: string, args: readonly string[] = []): string[] {
  return ['-e', script, ...args];
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('Graphify safety boundary', () => {
  test('rejects a relative RunStore root', () => {
    const paths = createSafetyPaths();

    expect(() =>
      assertSafeRoots(
        createPolicy(paths, { runStoreRoot: 'relative-run-store' }),
      ),
    ).toThrow(/absolute/i);
  });

  test('rejects a RunStore contained by the reviewed repository', () => {
    const paths = createSafetyPaths();
    const nestedRunStore = path.join(paths.reviewedRepository, 'run-store');
    fs.mkdirSync(nestedRunStore);

    expect(() =>
      assertSafeRoots(createPolicy(paths, { runStoreRoot: nestedRunStore })),
    ).toThrow(/contain|overlap|distinct/i);
  });

  test('rejects a reviewed repository contained by the RunStore', () => {
    const paths = createSafetyPaths();
    const nestedRepository = path.join(paths.runStoreRoot, 'reviewed');
    fs.mkdirSync(nestedRepository);

    expect(() =>
      assertSafeRoots(
        createPolicy(paths, { reviewedRepository: nestedRepository }),
      ),
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
      assertSafeRoots(createPolicy(paths, { runStoreRoot: escapedPath })),
    ).toThrow(/symlink|escape|realpath|contain/i);
  });

  test('rejects a symlink escape from the RunStore', () => {
    const paths = createSafetyPaths();
    const escapedTarget = path.join(paths.sandbox, 'escaped-repository');
    const escapedPath = path.join(
      paths.runStoreRoot,
      'reviewed-repository-symlink',
    );
    fs.mkdirSync(escapedTarget);
    fs.symlinkSync(escapedTarget, escapedPath, 'dir');

    expect(() =>
      assertSafeRoots(
        createPolicy(paths, { reviewedRepository: escapedPath }),
      ),
    ).toThrow(/symlink|escape|realpath|contain/i);
  });

  test('accepts two distinct absolute realpaths', () => {
    const paths = createSafetyPaths();

    expect(() => assertSafeRoots(createPolicy(paths))).not.toThrow();
  });
});

describe('Graphify trusted execution contract', () => {
  test('requires an absolute trusted executable', async () => {
    const paths = createSafetyPaths();

    await expect(
      runTrustedProcess(
        createPolicy(paths, { trustedExecutable: 'graphify' }),
        [],
      ),
    ).rejects.toThrow(/absolute/i);
  });

  test('rejects an executable outside the trusted allowlist', async () => {
    const paths = createSafetyPaths();
    const untrustedExecutable = path.join(paths.sandbox, 'untrusted');

    await expect(
      runTrustedProcess(
        createPolicy(paths, { trustedExecutable: untrustedExecutable }),
        [],
      ),
    ).rejects.toThrow(/allowlist|trusted|executable|not found|ENOENT/i);
  });

  test('rejects repository configuration that selects an executable path', async () => {
    const paths = createSafetyPaths();
    const repositoryExecutablePath = path.join(
      paths.sandbox,
      'repository-selected-executable',
    );

    await expect(
      runTrustedProcess(createPolicy(paths), [
        '--executable',
        repositoryExecutablePath,
      ]),
    ).rejects.toThrow(/repository configuration|executable|trusted/i);
  });

  test('rejects repository configuration that selects a plugin path', async () => {
    const paths = createSafetyPaths();
    const repositoryPluginPath = path.join(
      paths.sandbox,
      'repository-selected-plugin',
    );

    await expect(
      runTrustedProcess(createPolicy(paths), ['--plugin', repositoryPluginPath]),
    ).rejects.toThrow(/repository configuration|plugin|config/i);
  });

  test('uses a fixed staging cwd and never the reviewed repository', async () => {
    const paths = createSafetyPaths();

    const result = await runTrustedProcess(
      createPolicy(paths),
      nodeArgv('process.stdout.write(process.cwd())'),
    );

    expect(result.stdout).toBe(paths.stagingRoot);
    expect(result.stdout).not.toBe(paths.reviewedRepository);
  });

  test('passes only the minimal allowlisted environment to the child', async () => {
    const paths = createSafetyPaths();
    const sourceEnvironment = {
      PATH: '/usr/bin',
      LANG: 'C',
      REVIEW_API_TOKEN: 'review-secret',
      GITHUB_TOKEN: 'github-secret',
      GH_TOKEN: 'gh-secret',
      AWS_ACCESS_KEY_ID: 'provider-access-key',
      AWS_SECRET_ACCESS_KEY: 'provider-secret-key',
      ANTHROPIC_API_KEY: 'provider-api-key',
      UNRELATED_SECRET: 'unrelated-secret',
    };
    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      'LANG',
    ]);

    expect(environment).toEqual({ PATH: '/usr/bin', LANG: 'C' });

    const previousEnvironment = new Map(
      Object.keys(sourceEnvironment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, sourceEnvironment);

    try {
      const result = await runTrustedProcess(
        createPolicy(paths),
        nodeArgv('process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'),
      );

      expect(JSON.parse(result.stdout)).toEqual(['LANG', 'PATH']);
    } finally {
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test('preserves spaces, tabs, newlines, Unicode, and leading dashes in argv', async () => {
    const paths = createSafetyPaths();
    const argv = [
      'value with spaces',
      'value\twith\ttabs',
      'value\nwith\nnewlines',
      'unicodé-雪-🛡️',
      '--leading-dash',
    ];

    const result = await runTrustedProcess(
      createPolicy(paths),
      nodeArgv(
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        argv,
      ),
    );

    expect(JSON.parse(result.stdout)).toEqual(argv);
  });

  test('disables the shell', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.sandbox, 'shell-marker');
    const shellPayload = `$(touch ${marker})`;

    const result = await runTrustedProcess(
      createPolicy(paths),
      nodeArgv(
        'process.stdout.write(process.argv[1] ?? "")',
        [shellPayload],
      ),
    );

    expect(result.stdout).toBe(shellPayload);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('fails closed when stdout or stderr exceeds the configured limits', async () => {
    const outputs = [
      'process.stdout.write(\'x\'.repeat(1024 * 1024 + 1))',
      'process.stderr.write(\'x\'.repeat(1024 * 1024 + 1))',
    ];

    for (const script of outputs) {
      const paths = createSafetyPaths();

      await expect(
        runTrustedProcess(createPolicy(paths), nodeArgv(script)),
      ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    }
  });

  test('terminates the process group on timeout and returns sanitized diagnostics', async () => {
    const paths = createSafetyPaths();
    const survivingChildMarker = path.join(paths.sandbox, 'surviving-child');
    const secret = 'must-not-appear-in-diagnostics';
    const previousToken = process.env.REVIEW_API_TOKEN;
    process.env.REVIEW_API_TOKEN = secret;

    try {
      const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(survivingChildMarker)}, 'survived'), 300)`;
      const parentScript = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); setTimeout(() => {}, 60_000)`;
      const error = await runTrustedProcess(
        createPolicy(paths, { timeoutMs: 50 }),
        nodeArgv(parentScript),
      ).catch((caughtError: unknown) => caughtError);

      expect(error).toMatchObject({
        code: 'TIMEOUT',
        diagnostics: expect.any(String),
      });
      expect((error as { diagnostics: string }).diagnostics).not.toContain(
        secret,
      );
      expect(JSON.stringify(error)).not.toContain(secret);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fs.existsSync(survivingChildMarker)).toBe(false);
    } finally {
      if (previousToken === undefined) {
        delete process.env.REVIEW_API_TOKEN;
      } else {
        process.env.REVIEW_API_TOKEN = previousToken;
      }
    }
  });

  test('fails closed when network isolation is unavailable', async () => {
    const paths = createSafetyPaths();
    const startedMarker = path.join(paths.sandbox, 'started-child');

    await expect(
      runTrustedProcess(
        createPolicy(paths, {
          networkIsolation: {
            mode: 'disabled',
            evidence: 'unavailable',
            assertEnforced: async () => {
              throw new Error('network isolation unavailable');
            },
          },
        }),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(startedMarker)}, 'started')`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_ISOLATION_UNAVAILABLE' });
    expect(fs.existsSync(startedMarker)).toBe(false);
  });
});
