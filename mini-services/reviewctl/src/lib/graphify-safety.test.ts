import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafeRoots,
  createMinimalEnvironment,
  type GraphifySafetyPolicy,
  runTrustedProcess,
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

function canonicalPath(filePath: string): string {
  return fs.realpathSync.native(filePath);
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
      assertSafeRoots(createPolicy(paths, { reviewedRepository: escapedPath })),
    ).toThrow(/symlink|escape|realpath|contain/i);
  });

  test('rejects roots that resolve to the same realpath', () => {
    const paths = createSafetyPaths();
    const repositoryAlias = path.join(paths.sandbox, 'repository-alias');
    fs.symlinkSync(paths.runStoreRoot, repositoryAlias, 'dir');

    expect(() =>
      assertSafeRoots(
        createPolicy(paths, { reviewedRepository: repositoryAlias }),
      ),
    ).toThrow(/same|equal|overlap|distinct|realpath/i);
  });

  test('accepts two distinct absolute realpaths', () => {
    const paths = createSafetyPaths();

    expect(() => assertSafeRoots(createPolicy(paths))).not.toThrow();
  });
});

describe('Graphify trusted execution contract', () => {
  test('wraps a missing trusted executable as a sanitized safety error', async () => {
    const paths = createSafetyPaths();
    const missingExecutable = path.join(paths.sandbox, 'missing-graphify');

    const error = await runTrustedProcess(
      createPolicy(paths, { trustedExecutable: missingExecutable }),
      [],
    ).catch((caughtError: unknown) => caughtError);
    const diagnostics = (error as { diagnostics: string }).diagnostics;

    expect(error).toMatchObject({
      code: 'UNTRUSTED_EXECUTABLE',
      diagnostics: expect.any(String),
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(missingExecutable);
    expect(diagnostics).not.toContain(missingExecutable);
  });

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
    fs.writeFileSync(
      untrustedExecutable,
      '#!/bin/sh\nprintf "untrusted executable should not run"\n',
      { mode: 0o755 },
    );

    await expect(
      runTrustedProcess(
        createPolicy(paths, { trustedExecutable: untrustedExecutable }),
        [],
      ),
    ).rejects.toThrow(/allowlist|trusted/i);
  });

  test('rejects a repository-local symlink to the allowlisted executable', async () => {
    const paths = createSafetyPaths();
    const repositoryExecutableAlias = path.join(
      paths.reviewedRepository,
      'trusted-executable-alias',
    );
    fs.symlinkSync(process.execPath, repositoryExecutableAlias);

    await expect(
      runTrustedProcess(
        createPolicy(paths, { trustedExecutable: repositoryExecutableAlias }),
        nodeArgv('process.stdout.write(process.execPath)'),
      ),
    ).rejects.toThrow(/allowlist|trusted|canonical/i);
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
      runTrustedProcess(createPolicy(paths), [
        '--plugin',
        repositoryPluginPath,
      ]),
    ).rejects.toThrow(/repository configuration|plugin|config/i);
  });

  test('rejects repository configuration that passes arbitrary command template input', async () => {
    const paths = createSafetyPaths();
    const repositoryCommandTemplate = path.join(
      paths.reviewedRepository,
      'graphify-command-template.json',
    );

    await expect(
      runTrustedProcess(createPolicy(paths), [
        '--command-template',
        repositoryCommandTemplate,
      ]),
    ).rejects.toThrow(
      /repository configuration|command|template|input|trusted/i,
    );
  });

  test('uses a fixed staging cwd and never the reviewed repository', async () => {
    const paths = createSafetyPaths();

    const result = await runTrustedProcess(
      createPolicy(paths),
      nodeArgv('process.stdout.write(process.cwd())'),
    );

    expect(canonicalPath(result.stdout)).toBe(canonicalPath(paths.stagingRoot));
    expect(canonicalPath(result.stdout)).not.toBe(
      canonicalPath(paths.reviewedRepository),
    );
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
        nodeArgv(
          'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))',
        ),
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

  test('hard-denies provider credential selectors even when explicitly allowlisted', () => {
    const providerCredentialSelectors = [
      'NETRC',
      'GIT_ASKPASS',
      'GIT_CONFIG_GLOBAL',
      'NPM_CONFIG_USERCONFIG',
      'SSH_AGENT_PID',
      'SSH_AUTH_SOCK',
      'SSL_CERT_FILE',
      'CURL_HOME',
      'DOCKER_HOST',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_QUOTA_PROJECT',
      'CLOUDSDK_AUTH_ACCESS_TOKEN',
      'CLOUDSDK_CONFIG',
      'AWS_PROFILE',
      'AWS_DEFAULT_PROFILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CONFIG_FILE',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_TENANT_ID',
      'AZURE_AUTHORITY_HOST',
      'KUBECONFIG',
      'DOCKER_CONFIG',
      'VAULT_ADDR',
      'VAULT_TOKEN',
    ];
    const sourceEnvironment = Object.fromEntries([
      ['PATH', '/usr/bin'],
      ...providerCredentialSelectors.map((key) => [
        key,
        `provider-value-for-${key}`,
      ]),
    ]);

    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      ...providerCredentialSelectors,
    ]);

    expect(environment).toEqual({ PATH: '/usr/bin' });
    for (const key of providerCredentialSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('hard-denies generic config and socket selectors even when explicitly allowlisted', () => {
    const genericSelectors = [
      'CUSTOM_CONFIG',
      'CUSTOM_CONFIG_FILE',
      'CUSTOM_SOCKET_PATH',
    ];
    const sourceEnvironment = Object.fromEntries([
      ['PATH', '/usr/bin'],
      ['LANG', 'C'],
      ...genericSelectors.map((key) => [key, `selector-value-for-${key}`]),
    ]);

    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      'LANG',
      ...genericSelectors,
    ]);

    expect(environment).toEqual({ PATH: '/usr/bin', LANG: 'C' });
    for (const key of genericSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('hard-denies analogous credential selector names even when explicitly allowlisted', () => {
    const analogousSelectors = [
      'CUSTOM_CREDENTIAL',
      'CUSTOM_CREDENTIAL_FILE',
      'CUSTOM_CREDENTIALS',
      'CUSTOM_CREDENTIALS_FILE',
      'CUSTOM_AUTH',
      'CUSTOM_AUTH_FILE',
      'CUSTOM_PROFILE',
      'CUSTOM_CERT',
      'CUSTOM_CERT_PATH',
      'CUSTOM_CERT_FILE',
      'CUSTOM_PASS',
      'CUSTOM_PASS_FILE',
      'CUSTOM_PASSWORD_FILE',
      'CUSTOM_SSH',
      'CUSTOM_SSH_AGENT',
      'CUSTOM_SSH_AGENT_PID',
      'CUSTOM_SSH_AUTH_SOCK',
      'CUSTOM_PRIVATE_KEY_PATH',
      'CUSTOM_TOKEN_PATH',
      'CUSTOM_SECRET_PATH',
    ];
    const sourceEnvironment = Object.fromEntries([
      ['PATH', '/usr/bin'],
      ['LC_ALL', 'C'],
      ...analogousSelectors.map((key) => [key, `selector-value-for-${key}`]),
    ]);

    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      'LC_ALL',
      ...analogousSelectors,
    ]);

    expect(environment).toEqual({ PATH: '/usr/bin', LC_ALL: 'C' });
    for (const key of analogousSelectors) {
      expect(environment).not.toHaveProperty(key);
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
      nodeArgv('process.stdout.write(process.argv[1] ?? "")', [shellPayload]),
    );

    expect(result.stdout).toBe(shellPayload);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('fails closed when stdout or stderr exceeds the configured limits', async () => {
    const outputs = [
      "process.stdout.write('x'.repeat(1024 * 1024 + 1))",
      "process.stderr.write('x'.repeat(1024 * 1024 + 1))",
    ];

    for (const script of outputs) {
      const paths = createSafetyPaths();

      await expect(
        runTrustedProcess(createPolicy(paths), nodeArgv(script)),
      ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    }
  });

  test('returns a distinct fail-closed containment error on timeout', async () => {
    const paths = createSafetyPaths();
    const startedChildMarker = path.join(paths.sandbox, 'started-child');
    const survivingChildMarker = path.join(paths.sandbox, 'surviving-child');
    const secret = 'must-not-appear-in-diagnostics';
    const previousToken = process.env.REVIEW_API_TOKEN;
    process.env.REVIEW_API_TOKEN = secret;

    try {
      const childScript = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(startedChildMarker)}, 'started'); setTimeout(() => fs.writeFileSync(${JSON.stringify(survivingChildMarker)}, 'survived'), 300); setTimeout(() => {}, 60_000)`;
      const parentScript = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); while (!fs.existsSync(${JSON.stringify(startedChildMarker)})) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); } setTimeout(() => {}, 60_000)`;
      const error = await runTrustedProcess(
        createPolicy(paths, { timeoutMs: 50 }),
        nodeArgv(parentScript),
      ).catch((caughtError: unknown) => caughtError);

      expect(error).toMatchObject({
        code: 'PROCESS_CONTAINMENT_UNVERIFIED',
        diagnostics: expect.any(String),
      });
      expect((error as { diagnostics: string }).diagnostics).not.toContain(
        secret,
      );
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(fs.existsSync(startedChildMarker)).toBe(true);
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

  test('does not report detached descendants as safely contained after timeout', async () => {
    const paths = createSafetyPaths();
    const detachedChildStartedMarker = path.join(
      paths.sandbox,
      'detached-child-started',
    );
    const detachedChildSurvivedMarker = path.join(
      paths.sandbox,
      'detached-child-survived',
    );
    const detachedChildPidFile = path.join(paths.sandbox, 'detached-child.pid');

    const childScript = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(detachedChildPidFile)}, String(process.pid))`,
      `fs.writeFileSync(${JSON.stringify(detachedChildStartedMarker)}, 'started')`,
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(detachedChildSurvivedMarker)}, 'survived'), 250)`,
      'setTimeout(() => {}, 60_000)',
    ].join(';');
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      "const fs = require('node:fs')",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, stdio: 'ignore' })`,
      'child.unref()',
      `while (!fs.existsSync(${JSON.stringify(detachedChildStartedMarker)})) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) }`,
      'setTimeout(() => {}, 60_000)',
    ].join(';');

    try {
      const error = await runTrustedProcess(
        createPolicy(paths, { timeoutMs: 50 }),
        nodeArgv(parentScript),
      ).catch((caughtError: unknown) => caughtError);

      expect(error).toMatchObject({
        code: 'PROCESS_CONTAINMENT_UNVERIFIED',
        diagnostics: expect.any(String),
      });
      expect(fs.existsSync(detachedChildStartedMarker)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fs.existsSync(detachedChildSurvivedMarker)).toBe(true);
    } finally {
      if (fs.existsSync(detachedChildPidFile)) {
        try {
          process.kill(
            Number(fs.readFileSync(detachedChildPidFile, 'utf8')),
            'SIGKILL',
          );
        } catch {
          // The process may have already exited; cleanup is best effort.
        }
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
