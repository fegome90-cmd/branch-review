import fs from 'node:fs';
import path from 'node:path';

export interface GraphifySafetyPolicy {
  reviewedRepository: string;
  stagingRoot: string;
  runStoreRoot: string;
  trustedExecutable: string;
  allowedEnvironmentKeys: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  networkIsolation: NetworkIsolationCapability;
}

export interface NetworkIsolationCapability {
  readonly mode: 'disabled';
  readonly evidence: string;
  assertEnforced(): Promise<void>;
}

export interface TrustedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  elapsedMs: number;
}

export interface SafeGraphifyRoots {
  reviewedRepository: string;
  stagingRoot: string;
  runStoreRoot: string;
}

type SafetyErrorCode =
  | 'INVALID_ROOT'
  | 'INVALID_POLICY_LIMIT'
  | 'UNTRUSTED_EXECUTABLE'
  | 'REPOSITORY_CONTROLLED_ARGUMENT'
  | 'FILESYSTEM_ISOLATION_UNAVAILABLE'
  | 'NETWORK_ISOLATION_UNAVAILABLE'
  | 'PROCESS_CONTAINMENT_UNVERIFIED'
  | 'PROCESS_FAILED';

export class GraphifySafetyError extends Error {
  readonly code: SafetyErrorCode;
  readonly diagnostics: string;

  constructor(code: SafetyErrorCode, message: string, diagnostics = message) {
    super(message);
    this.name = 'GraphifySafetyError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

const supportedTrustedNodeFlag = '-e';

const safeEnvironmentValues = {
  PATH: '/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  LC_CTYPE: 'C.UTF-8',
} as const satisfies NodeJS.ProcessEnv;

const blockedEnvironmentKeyNames = new Set([
  'REVIEW_API_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NETRC',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'NPM_CONFIG_GLOBALCONFIG',
  'NPM_CONFIG_REGISTRY',
  'NPM_CONFIG_USERCONFIG',
  'SSH_AGENT_PID',
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
  'DOCKER_HOST',
  'SSH_AUTH_SOCK',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_HOME',
  'VAULT_ADDR',
  'VAULT_TOKEN',
]);

const blockedEnvironmentKeySubstrings = [
  'PASSPHRASE',
  'AUTHORIZATION',
  'CREDENTIAL',
  'PASSWORD',
  'PROVIDER',
  'CONFIG',
  'BEARER',
  'CERTPATH',
  'SECRET',
  'SOCKET',
  'PROFILE',
  'GITHUB',
  'REVIEW',
  'TOKEN',
  'CLOUD',
  'AGENT',
  'NETRC',
  'PASS',
  'AUTH',
  'CERT',
  'KEY',
  'SSH',
  'APP',
  'PNPM',
  'YARN',
  'KUBE',
  'AWS',
  'AZURE',
  'GOOGLE',
  'CLOUDSDK',
  'GIT',
  'NPM',
  'DOCKER',
  'VAULT',
];

function immutableDiagnosticsError(
  error: GraphifySafetyError,
): GraphifySafetyError {
  const diagnostics = error.diagnostics;
  return new Proxy(error, {
    get(target, property, receiver) {
      if (property === 'diagnostics') {
        return diagnostics;
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property === 'diagnostics') {
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    },
  });
}

function invalidRoot(label: string, reason: string): GraphifySafetyError {
  return new GraphifySafetyError('INVALID_ROOT', `${label} ${reason}`);
}

function isGraphifySafetyError(error: unknown): error is GraphifySafetyError {
  return error instanceof GraphifySafetyError;
}

function sanitizedFilesystemError(
  code: SafetyErrorCode,
  label: string,
  action: string,
): GraphifySafetyError {
  const message = `${label} ${action}`;
  return new GraphifySafetyError(
    code,
    message,
    `${label} validation failed while ${action}`,
  );
}

function wrapFilesystemError<T>(
  code: SafetyErrorCode,
  label: string,
  action: string,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    if (isGraphifySafetyError(error)) {
      throw error;
    }
    throw sanitizedFilesystemError(code, label, action);
  }
}

function assertAbsolutePath(label: string, value: string): void {
  if (!path.isAbsolute(value)) {
    throw invalidRoot(label, 'must be an absolute path');
  }
}

function assertDirectoryIfExists(label: string, value: string): void {
  try {
    const stats = fs.statSync(value);
    if (!stats.isDirectory()) {
      throw invalidRoot(
        label,
        'must be a directory or a not-yet-created directory path',
      );
    }
  } catch (error) {
    if (isGraphifySafetyError(error)) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw sanitizedFilesystemError(
        'INVALID_ROOT',
        label,
        'must be a resolvable directory path',
      );
    }
  }
}

function assertNoDanglingSymlinkComponents(label: string, value: string): void {
  const resolved = path.resolve(value);
  const parsed = path.parse(resolved);
  const parts = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;

  for (const part of parts) {
    current = path.join(current, part);

    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      throw sanitizedFilesystemError(
        'INVALID_ROOT',
        label,
        'must have resolvable path components',
      );
    }

    if (!stats.isSymbolicLink()) {
      continue;
    }

    try {
      fs.realpathSync.native(current);
    } catch {
      throw sanitizedFilesystemError(
        'INVALID_ROOT',
        label,
        'must not contain dangling symlink components',
      );
    }
  }
}

function nearestExistingAncestor(
  label: string,
  value: string,
): { ancestor: string; missing: string[] } {
  const missing: string[] = [];
  let current = path.resolve(value);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw invalidRoot(label, 'must have an existing ancestor directory');
    }
    missing.unshift(path.basename(current));
    current = parent;
  }

  const stats = wrapFilesystemError(
    'INVALID_ROOT',
    label,
    'must have a resolvable existing ancestor directory',
    () => fs.statSync(current),
  );
  if (!stats.isDirectory()) {
    throw invalidRoot(label, 'nearest existing ancestor must be a directory');
  }

  return { ancestor: current, missing };
}

function canonicalDirectory(label: string, value: string): string {
  assertAbsolutePath(label, value);
  assertNoDanglingSymlinkComponents(label, value);
  assertDirectoryIfExists(label, value);

  const { ancestor, missing } = nearestExistingAncestor(label, value);
  const canonicalAncestor = wrapFilesystemError(
    'INVALID_ROOT',
    label,
    'must have a canonical realpath',
    () => fs.realpathSync.native(ancestor),
  );
  return path.resolve(canonicalAncestor, ...missing);
}

function normalizedDirectory(label: string, value: string): string {
  assertAbsolutePath(label, value);
  return path.resolve(value);
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function assertDistinctDisjointRoots(
  firstLabel: string,
  first: string,
  secondLabel: string,
  second: string,
): void {
  if (first === second) {
    throw new GraphifySafetyError(
      'INVALID_ROOT',
      `${firstLabel} and ${secondLabel} must be distinct roots with different realpath values`,
      'root validation failed: equal realpath roots are not allowed',
    );
  }

  if (isSameOrInside(first, second) || isSameOrInside(second, first)) {
    throw new GraphifySafetyError(
      'INVALID_ROOT',
      `${firstLabel} and ${secondLabel} must be distinct, non-overlapping roots`,
      'root validation failed: containment or overlap detected after realpath resolution',
    );
  }
}

function assertNoSymlinkEscape(
  label: string,
  requested: string,
  canonical: string,
  boundaries: readonly {
    label: string;
    requested: string;
    canonical: string;
  }[],
): void {
  for (const boundary of boundaries) {
    if (label === boundary.label) {
      continue;
    }

    const requestedInsideBoundary = isSameOrInside(
      boundary.requested,
      requested,
    );
    const canonicalInsideBoundary = isSameOrInside(
      boundary.canonical,
      canonical,
    );

    if (requestedInsideBoundary !== canonicalInsideBoundary) {
      throw new GraphifySafetyError(
        'INVALID_ROOT',
        `${label} symlink realpath escapes ${boundary.label}`,
        'root validation failed: symlink realpath escape detected',
      );
    }
  }
}

export function assertSafeRoots(
  policy: GraphifySafetyPolicy,
): SafeGraphifyRoots {
  const requestedRoots = [
    {
      label: 'reviewedRepository',
      requested: normalizedDirectory(
        'reviewedRepository',
        policy.reviewedRepository,
      ),
      canonical: canonicalDirectory(
        'reviewedRepository',
        policy.reviewedRepository,
      ),
    },
    {
      label: 'stagingRoot',
      requested: normalizedDirectory('stagingRoot', policy.stagingRoot),
      canonical: canonicalDirectory('stagingRoot', policy.stagingRoot),
    },
    {
      label: 'runStoreRoot',
      requested: normalizedDirectory('runStoreRoot', policy.runStoreRoot),
      canonical: canonicalDirectory('runStoreRoot', policy.runStoreRoot),
    },
  ] as const;

  for (const root of requestedRoots) {
    assertAbsolutePath(root.label, root.canonical);
  }

  for (const root of requestedRoots) {
    assertNoSymlinkEscape(
      root.label,
      root.requested,
      root.canonical,
      requestedRoots,
    );
  }

  for (let index = 0; index < requestedRoots.length; index += 1) {
    for (
      let otherIndex = index + 1;
      otherIndex < requestedRoots.length;
      otherIndex += 1
    ) {
      const first = requestedRoots[index];
      const second = requestedRoots[otherIndex];
      assertDistinctDisjointRoots(
        first.label,
        first.requested,
        second.label,
        second.requested,
      );
      assertDistinctDisjointRoots(
        first.label,
        first.canonical,
        second.label,
        second.canonical,
      );
    }
  }

  return {
    reviewedRepository: requestedRoots[0].canonical,
    stagingRoot: requestedRoots[1].canonical,
    runStoreRoot: requestedRoots[2].canonical,
  };
}

function isBlockedEnvironmentKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  const compactKey = normalizedKey.replace(/[^A-Z0-9]/gu, '');
  if (
    blockedEnvironmentKeyNames.has(normalizedKey) ||
    blockedEnvironmentKeySubstrings.some((substring) =>
      compactKey.includes(substring),
    )
  ) {
    return true;
  }

  return false;
}

export function createMinimalEnvironment(
  _source: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of allowedKeys) {
    if (isBlockedEnvironmentKey(key)) {
      continue;
    }

    if (Object.hasOwn(safeEnvironmentValues, key)) {
      environment[key] =
        safeEnvironmentValues[key as keyof typeof safeEnvironmentValues];
    }
  }

  return environment;
}

function assertTrustedExecutable(executable: string): string {
  if (!path.isAbsolute(executable)) {
    throw new GraphifySafetyError(
      'UNTRUSTED_EXECUTABLE',
      'trusted executable must be absolute',
    );
  }

  const canonicalExecutable = wrapFilesystemError(
    'UNTRUSTED_EXECUTABLE',
    'trusted executable',
    'must resolve to a trusted host-owned executable',
    () => fs.realpathSync.native(executable),
  );
  const canonicalProcessExecutable = wrapFilesystemError(
    'UNTRUSTED_EXECUTABLE',
    'trusted executable allowlist',
    'must resolve to a trusted host-owned executable',
    () => fs.realpathSync.native(process.execPath),
  );
  if (
    path.resolve(executable) !== canonicalProcessExecutable ||
    canonicalExecutable !== canonicalProcessExecutable
  ) {
    throw new GraphifySafetyError(
      'UNTRUSTED_EXECUTABLE',
      'trusted executable must match the canonical allowlist path',
    );
  }

  return canonicalProcessExecutable;
}

function assertSupportedTrustedArguments(argv: readonly string[]): void {
  if (argv.length === 0) {
    return;
  }

  if (argv[0] === supportedTrustedNodeFlag && argv.length >= 2) {
    return;
  }

  throw new GraphifySafetyError(
    'REPOSITORY_CONTROLLED_ARGUMENT',
    'repository configuration, plugin, config, loader, alias, and command inputs must match the host-owned trusted argument schema',
  );
}

function assertPositiveSafeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GraphifySafetyError(
      'INVALID_POLICY_LIMIT',
      `${label} must be a positive safe integer`,
      `${label} validation failed: expected a positive safe integer`,
    );
  }
}

function assertPolicyLimits(policy: GraphifySafetyPolicy): void {
  assertPositiveSafeInteger('timeoutMs', policy.timeoutMs);
  assertPositiveSafeInteger('maxOutputBytes', policy.maxOutputBytes);
}

function filesystemIsolationUnavailableError(): GraphifySafetyError {
  return immutableDiagnosticsError(
    new GraphifySafetyError(
      'FILESYSTEM_ISOLATION_UNAVAILABLE',
      'filesystem and process isolation provider is unavailable',
      'pre-execution isolation failed closed: a genuine host filesystem/process containment provider is required before trusted process execution',
    ),
  );
}

export async function runTrustedProcess(
  policy: GraphifySafetyPolicy,
  argv: readonly string[],
): Promise<TrustedProcessResult> {
  const safeRoots = assertSafeRoots(policy);
  const trustedExecutable = assertTrustedExecutable(policy.trustedExecutable);
  assertSupportedTrustedArguments(argv);
  assertPolicyLimits(policy);
  void safeRoots;
  void trustedExecutable;

  // A genuine host filesystem/process containment provider is a future
  // prerequisite; cwd alone is not containment, so Slice 1 fails closed here.
  throw filesystemIsolationUnavailableError();
}
