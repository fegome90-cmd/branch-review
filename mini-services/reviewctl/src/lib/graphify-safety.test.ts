import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafeRoots,
  createMinimalEnvironment,
  GraphifySafetyError,
  type GraphifySafetyPolicy,
  isSameOrInside,
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

async function expectFilesystemIsolationUnavailable(
  operation: Promise<unknown>,
): Promise<unknown> {
  const error = await operation.catch((caughtError: unknown) => caughtError);

  expect(error).toMatchObject({
    code: 'FILESYSTEM_ISOLATION_UNAVAILABLE',
    diagnostics: expect.any(String),
  });
  return error;
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

  test('rejects a dangling symlink root instead of treating it as not yet created', () => {
    const paths = createSafetyPaths();
    const danglingTarget = path.join(paths.sandbox, 'missing-target');
    const danglingRoot = path.join(paths.sandbox, 'dangling-run-store');
    fs.symlinkSync(danglingTarget, danglingRoot, 'dir');

    const error = (() => {
      try {
        assertSafeRoots(createPolicy(paths, { runStoreRoot: danglingRoot }));
        return undefined;
      } catch (caughtError) {
        return caughtError;
      }
    })();

    const diagnostics = (error as { diagnostics: string }).diagnostics;

    expect(error).toMatchObject({
      code: 'INVALID_ROOT',
    });
    expect(typeof diagnostics).toBe('string');
    expect((error as Error).message.includes(danglingRoot)).toBe(false);
    expect(diagnostics.includes(danglingRoot)).toBe(false);
    expect((error as Error).message.includes(danglingTarget)).toBe(false);
    expect(diagnostics.includes(danglingTarget)).toBe(false);
  });

  test('accepts two distinct absolute realpaths', () => {
    const paths = createSafetyPaths();

    expect(() => assertSafeRoots(createPolicy(paths))).not.toThrow();
  });

  test('treats names beginning with .. as inside when they are not parent escapes', () => {
    const paths = createSafetyPaths();
    const dotdotNamedRoot = path.join(paths.reviewedRepository, '..run-store');
    fs.mkdirSync(dotdotNamedRoot);

    expect(isSameOrInside(paths.reviewedRepository, dotdotNamedRoot)).toBe(
      true,
    );
    expect(
      isSameOrInside(paths.reviewedRepository, paths.reviewedRepository),
    ).toBe(true);
    const trueEscape = path.join(
      path.dirname(paths.reviewedRepository),
      'sibling',
    );
    expect(isSameOrInside(paths.reviewedRepository, trueEscape)).toBe(false);
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

  test('rejects execution before relying on cwd as containment', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.stagingRoot, 'cwd-marker');

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd())`,
        ),
      ),
    );

    expect(fs.existsSync(marker)).toBe(false);
    expect(canonicalPath(paths.stagingRoot)).not.toBe(
      canonicalPath(paths.reviewedRepository),
    );
  });

  test('constructs deterministic policy-owned environment but rejects execution before passing it to a child', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.stagingRoot, 'environment-marker');
    const sourceEnvironment = {
      PATH: '/attacker/bin',
      LANG: 'attacker-locale',
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

    expect(environment).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C' });

    const previousEnvironment = new Map(
      Object.keys(sourceEnvironment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, sourceEnvironment);

    try {
      await expectFilesystemIsolationUnavailable(
        runTrustedProcess(
          createPolicy(paths),
          nodeArgv(
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.env))`,
          ),
        ),
      );

      expect(fs.existsSync(marker)).toBe(false);
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

  test('does not let process.env mutations influence fixed safe environment values before rejecting execution', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.stagingRoot, 'mutated-environment-marker');
    const previousPath = process.env.PATH;
    const previousLang = process.env.LANG;
    process.env.PATH = '/repo-controlled/bin';
    process.env.LANG = 'repo_CONTROLLED.UTF-8';

    try {
      await expectFilesystemIsolationUnavailable(
        runTrustedProcess(
          createPolicy(paths),
          nodeArgv(
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.env))`,
          ),
        ),
      );

      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      if (previousLang === undefined) {
        delete process.env.LANG;
      } else {
        process.env.LANG = previousLang;
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

    expect(environment).toEqual({ PATH: '/usr/bin:/bin' });
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

    expect(environment).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C' });
    for (const key of genericSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('hard-denies generic provider cloud review and GitHub selectors even when explicitly allowlisted', () => {
    const genericSelectors = [
      'CUSTOM_PROVIDER',
      'CUSTOM_PROVIDER_FILE',
      'CUSTOM_CLOUD',
      'CUSTOM_CLOUD_FILE',
      'REVIEW_PROVIDER',
      'REVIEW_PROVIDER_FILE',
      'REVIEW_CLOUD',
      'REVIEW_CLOUD_FILE',
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'CUSTOM_GITHUB_APP_ID',
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

    expect(environment).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C' });
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

    expect(environment).toEqual({ PATH: '/usr/bin:/bin', LC_ALL: 'C' });
    for (const key of analogousSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('hard-denies compound credential selector names even when explicitly allowlisted', () => {
    const compoundSelectors = [
      'CUSTOM_PASSPHRASE',
      'CUSTOM_AUTHORIZATION_HEADER',
      'CUSTOM_BEARER',
      'CUSTOM_CERTPATH',
    ];
    const sourceEnvironment = Object.fromEntries([
      ['PATH', '/usr/bin'],
      ['LANG', 'C'],
      ...compoundSelectors.map((key) => [key, `selector-value-for-${key}`]),
    ]);

    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      'LANG',
      ...compoundSelectors,
    ]);

    expect(environment).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C' });
    for (const key of compoundSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('hard-denies sensitive LC_* selector names before locale allowances', () => {
    const sensitiveLocaleSelectors = [
      'LC_AUTH',
      'LC_TOKEN',
      'LC_GITHUB_APP_ID',
      'LC_CUSTOM_CONFIG',
      'LC_CERTPATH',
      'LC_PASSPHRASE',
      'LC_AUTHORIZATION_HEADER',
    ];
    const sourceEnvironment = Object.fromEntries([
      ['PATH', '/usr/bin'],
      ['LANG', 'C'],
      ['LC_ALL', 'C'],
      ['LC_CTYPE', 'UTF-8'],
      ...sensitiveLocaleSelectors.map((key) => [
        key,
        `selector-value-for-${key}`,
      ]),
    ]);

    const environment = createMinimalEnvironment(sourceEnvironment, [
      'PATH',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      ...sensitiveLocaleSelectors,
    ]);

    expect(environment).toEqual({
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      LC_CTYPE: 'C.UTF-8',
    });
    for (const key of sensitiveLocaleSelectors) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  test('rejects future loader config and alias argv flags outside the supported trusted schema', async () => {
    const paths = createSafetyPaths();
    const unsafeArgvShapes = [
      ['--import', './repo-loader.mjs'],
      ['--require', './repo-hook.cjs'],
      ['--experimental-loader=./repo-loader.mjs'],
      ['--loader', './repo-loader.mjs'],
      ['--env-file', './repo.env'],
      ['--config', './repo-config.json'],
      ['--eval', 'process.stdout.write("unsafe")'],
      ['--print', 'process.cwd()'],
      ['--run', 'repo-script'],
      ['--conditions', 'repo-condition'],
    ];

    for (const argv of unsafeArgvShapes) {
      await expect(
        runTrustedProcess(createPolicy(paths), argv),
      ).rejects.toMatchObject({
        code: 'REPOSITORY_CONTROLLED_ARGUMENT',
      });
    }
  });

  test('accepts safe argv shape with spaces, tabs, newlines, Unicode, and leading dashes before rejecting execution', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.stagingRoot, 'argv-marker');
    const argv = [
      'value with spaces',
      'value\twith\ttabs',
      'value\nwith\nnewlines',
      'unicodé-雪-🛡️',
      '--leading-dash',
    ];

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(1)))`,
          argv,
        ),
      ),
    );

    expect(fs.existsSync(marker)).toBe(false);
  });

  test('rejects execution before shell metacharacters can create a marker', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.sandbox, 'shell-marker');
    const shellPayload = `$(touch ${marker})`;

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths),
        nodeArgv('process.stdout.write(process.argv[1] ?? "")', [shellPayload]),
      ),
    );

    expect(fs.existsSync(marker)).toBe(false);
  });

  test('rejects invalid timeout and output limits before network callback or child creation', async () => {
    const invalidLimits = [
      { field: 'timeoutMs', value: Number.NaN },
      { field: 'timeoutMs', value: Number.POSITIVE_INFINITY },
      { field: 'timeoutMs', value: -1 },
      { field: 'timeoutMs', value: 0 },
      { field: 'timeoutMs', value: 1.5 },
      { field: 'timeoutMs', value: Number.MAX_SAFE_INTEGER + 1 },
      { field: 'maxOutputBytes', value: Number.NaN },
      { field: 'maxOutputBytes', value: Number.POSITIVE_INFINITY },
      { field: 'maxOutputBytes', value: -1 },
      { field: 'maxOutputBytes', value: 0 },
      { field: 'maxOutputBytes', value: 1.5 },
      { field: 'maxOutputBytes', value: Number.MAX_SAFE_INTEGER + 1 },
    ] as const;

    for (const invalidLimit of invalidLimits) {
      const paths = createSafetyPaths();
      const marker = path.join(
        paths.stagingRoot,
        `${invalidLimit.field}-${String(invalidLimit.value)}-marker`,
      );
      let networkCallbackInvoked = false;

      const error = await runTrustedProcess(
        createPolicy(paths, {
          [invalidLimit.field]: invalidLimit.value,
          networkIsolation: {
            mode: 'disabled',
            evidence: 'must not be consulted for invalid limits',
            assertEnforced: async () => {
              networkCallbackInvoked = true;
            },
          },
        }),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`,
        ),
      ).catch((caughtError: unknown) => caughtError);

      expect(error).toMatchObject({
        code: 'INVALID_POLICY_LIMIT',
      });
      expect(networkCallbackInvoked).toBe(false);
      expect(fs.existsSync(marker)).toBe(false);
    }
  });

  test('rejects forged callback-shaped host capabilities before invoking callbacks or spawning', async () => {
    const paths = createSafetyPaths();
    const marker = path.join(paths.stagingRoot, 'forged-capability-marker');
    let networkCallbackInvoked = false;
    let forgedFilesystemCallbackInvoked = false;
    let forgedProcessCallbackInvoked = false;
    const forgedPolicy = {
      ...createPolicy(paths, {
        networkIsolation: {
          mode: 'disabled',
          evidence: 'must not be consulted before filesystem isolation exists',
          assertEnforced: async () => {
            networkCallbackInvoked = true;
          },
        },
      }),
      filesystemIsolation: {
        assertEnforced: async () => {
          forgedFilesystemCallbackInvoked = true;
        },
      },
      processIsolation: {
        assertEnforced: async () => {
          forgedProcessCallbackInvoked = true;
        },
      },
    } as GraphifySafetyPolicy;

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        forgedPolicy,
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`,
        ),
      ),
    );

    expect(networkCallbackInvoked).toBe(false);
    expect(forgedFilesystemCallbackInvoked).toBe(false);
    expect(forgedProcessCallbackInvoked).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('rejects outside-staging filesystem writes before execution', async () => {
    const paths = createSafetyPaths();
    const outsideStagingMarker = path.join(
      paths.runStoreRoot,
      'outside-staging-marker',
    );

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(outsideStagingMarker)}, 'outside')`,
        ),
      ),
    );

    expect(fs.existsSync(outsideStagingMarker)).toBe(false);
  });

  test('rejects detached-descendant probes before execution', async () => {
    const paths = createSafetyPaths();
    const detachedChildStartedMarker = path.join(
      paths.sandbox,
      'pre-execution-detached-child-started',
    );
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      "const fs = require('node:fs')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(detachedChildStartedMarker)}, 'started'); setTimeout(() => {}, 60_000)`)}], { detached: true, stdio: 'ignore' }).unref()`,
      "process.stdout.write('parent done')",
    ].join(';');

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(createPolicy(paths), nodeArgv(parentScript)),
    );

    expect(fs.existsSync(detachedChildStartedMarker)).toBe(false);
  });

  test('rejects otherwise-valid execution before relying on output-limit containment', async () => {
    const outputs = [
      "process.stdout.write('x'.repeat(1024 * 1024 + 1))",
      "process.stderr.write('x'.repeat(1024 * 1024 + 1))",
    ];

    for (const script of outputs) {
      const paths = createSafetyPaths();

      await expectFilesystemIsolationUnavailable(
        runTrustedProcess(createPolicy(paths), nodeArgv(script)),
      );
    }
  });

  test('rejects execution before a child can terminate itself with SIGTERM', async () => {
    const paths = createSafetyPaths();

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths),
        nodeArgv("process.kill(process.pid, 'SIGTERM')"),
      ),
    );
  });

  test('rejects output-limit detached-descendant probe before execution', async () => {
    const paths = createSafetyPaths();
    const detachedChildStartedMarker = path.join(
      paths.sandbox,
      'output-limit-detached-child-started',
    );
    const detachedChildSurvivedMarker = path.join(
      paths.sandbox,
      'output-limit-detached-child-survived',
    );
    const detachedChildPidFile = path.join(
      paths.sandbox,
      'output-limit-detached-child.pid',
    );

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
      "process.stdout.write('x'.repeat(1024 * 1024 + 1))",
      'setTimeout(() => {}, 60_000)',
    ].join(';');

    try {
      await expectFilesystemIsolationUnavailable(
        runTrustedProcess(createPolicy(paths), nodeArgv(parentScript)),
      );

      expect(fs.existsSync(detachedChildStartedMarker)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fs.existsSync(detachedChildSurvivedMarker)).toBe(false);
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

  test('rejects execution before timeout containment is needed', async () => {
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
      // Capture diagnostics before any matcher touches the error object:
      // bun's toMatchObject rewrites the matched property descriptor.
      const diagnostics = (error as { diagnostics: string }).diagnostics;
      expect(error).toMatchObject({
        code: 'FILESYSTEM_ISOLATION_UNAVAILABLE',
        diagnostics: expect.any(String),
      });

      expect(diagnostics).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(fs.existsSync(startedChildMarker)).toBe(false);
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

  test('rejects timeout detached-descendant probe before execution', async () => {
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
      await expectFilesystemIsolationUnavailable(
        runTrustedProcess(
          createPolicy(paths, { timeoutMs: 50 }),
          nodeArgv(parentScript),
        ),
      );

      expect(fs.existsSync(detachedChildStartedMarker)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fs.existsSync(detachedChildSurvivedMarker)).toBe(false);
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

  test('keeps the network isolation contract but rejects before relying on it as filesystem containment', async () => {
    const paths = createSafetyPaths();
    const startedMarker = path.join(paths.sandbox, 'started-child');
    let networkCallbackInvoked = false;

    await expectFilesystemIsolationUnavailable(
      runTrustedProcess(
        createPolicy(paths, {
          networkIsolation: {
            mode: 'disabled',
            evidence: 'unavailable',
            assertEnforced: async () => {
              networkCallbackInvoked = true;
            },
          },
        }),
        nodeArgv(
          `require('node:fs').writeFileSync(${JSON.stringify(startedMarker)}, 'started')`,
        ),
      ),
    );
    expect(networkCallbackInvoked).toBe(false);
    expect(fs.existsSync(startedMarker)).toBe(false);
  });
});

describe('GraphifySafetyError diagnostics immutability', () => {
  function createError(): GraphifySafetyError {
    return new GraphifySafetyError(
      'FILESYSTEM_ISOLATION_UNAVAILABLE' as GraphifySafetyError['code'],
      'filesystem and process isolation provider is unavailable',
      'pre-execution isolation failed closed',
    );
  }

  test('GraphifySafetyError diagnostics cannot be reassigned', () => {
    const error = createError();
    const original = error.diagnostics;

    // ES module strict mode throws TypeError when assigning to a
    // non-writable property — the property stays immutable either way.
    expect(() => {
      (error as { diagnostics: string }).diagnostics = 'tampered';
    }).toThrow(TypeError);
    expect(error.diagnostics).toBe(original);
    expect(error.diagnostics).not.toBe('tampered');
  });

  test('GraphifySafetyError diagnostics cannot be deleted', () => {
    const error = createError();
    const original = error.diagnostics;

    expect(() => {
      delete (error as { diagnostics?: string }).diagnostics;
    }).toThrow(TypeError);
    expect(error.diagnostics).toBe(original);
  });

  test('GraphifySafetyError diagnostics cannot be redefined via defineProperty', () => {
    const error = createError();
    const original = error.diagnostics;

    expect(() => {
      Object.defineProperty(error, 'diagnostics', {
        value: 'tampered',
        writable: true,
        configurable: true,
      });
    }).toThrow();
    expect(error.diagnostics).toBe(original);
    expect(error.diagnostics).not.toBe('tampered');
  });
});
