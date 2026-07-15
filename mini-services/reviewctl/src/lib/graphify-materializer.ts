import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertPositiveSafeInteger,
  assertSafeRoots,
  createMinimalEnvironment,
  type GraphifySafetyPolicy,
  isSameOrInside,
} from './graphify-safety.js';

const execFileAsync = promisify(execFile);

export interface RepositoryTarget {
  repositoryRoot: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
}

export interface MaterializationResult {
  stagingRoot: string;
  includedFiles: readonly string[];
  skippedFiles: readonly { path: string; reason: string }[];
}

type MaterializerErrorCode =
  | 'DIRTY_GIT_WORKTREE'
  | 'GIT_COMMAND_FAILED'
  | 'INVALID_GIT_EXECUTABLE'
  | 'INVALID_GIT_REF'
  | 'MATERIALIZATION_LIMIT_EXCEEDED'
  | 'PARTIAL_CLONE_REJECTED'
  | 'STAGING_CLEANUP_FAILED'
  | 'STAGING_WRITE_FAILED'
  | 'UNAPPROVED_CHANGED_PATH'
  | 'UNSAFE_GIT_PATH';

export class GraphifyMaterializerError extends Error {
  readonly code: MaterializerErrorCode;
  readonly diagnostics!: string;
  readonly #diagnosticsValue: string;

  constructor(
    code: MaterializerErrorCode,
    message: string,
    diagnostics = message,
  ) {
    super(message);
    this.name = 'GraphifyMaterializerError';
    this.code = code;
    this.#diagnosticsValue = diagnostics;
    Object.defineProperty(this, 'diagnostics', {
      configurable: false,
      enumerable: true,
      value: diagnostics,
      writable: false,
    });
  }

  toJSON(): { code: MaterializerErrorCode; diagnostics: string; name: string } {
    return {
      code: this.code,
      diagnostics: this.#diagnosticsValue,
      name: this.name,
    };
  }
}

export type GitInvocation = {
  argv: readonly string[];
  cwd: string;
  executable: string;
  env: NodeJS.ProcessEnv;
  shell: false;
};

export interface GraphifyGitRunner {
  readonly executable: string;
  run(invocation: GitInvocation): Promise<{ stdout: Buffer; stderr: Buffer }>;
}

export interface ResolveRepositoryTargetOptions {
  git?: GraphifyGitRunner;
  policy?: GraphifySafetyPolicy;
}

export interface MaterializeGitFileSetOptions {
  git?: GraphifyGitRunner;
  approvedPaths: readonly string[];
  maxFiles: number;
  maxBytes?: number;
  maxFileBytes?: number;
}

type TreeEntry = {
  mode: string;
  objectType: string;
  objectId: string;
  path: string;
};

type NormalizedGitPath = {
  rawPath: string;
  normalizedPath: string;
};

const hostGitExecutable = '/usr/bin/git';
const immutableShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const regularBlobModes = new Set(['100644', '100755']);
const isolatedGitConfigArgv = [
  // `--no-lazy-fetch` is a global option that must precede the subcommand.
  // On Git >=2.45 it definitively blocks lazy fetch of missing objects. On
  // Git <2.45 the unknown option makes git fail (non-zero exit), which gives
  // us a fail-closed guarantee: `runGit` surfaces that as GIT_COMMAND_FAILED
  // rather than silently proceeding with a partial clone.
  '--no-lazy-fetch',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
  // Neutralize lazy-fetch credential vectors. A partial clone can trigger a
  // promisor fetch when reading missing objects; that fetch reads local
  // .git/config (which the env overrides above do not cover) and may invoke
  // credential.helper (an arbitrary executable). `-c` overrides take
  // precedence over local config, so we blank these out defensively.
  '-c',
  'credential.helper=',
  '-c',
  'remote.origin.promisor=false',
  '-c',
  'http.proxy=',
  '-c',
  'https.proxy=',
] as const;

function safeGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...createMinimalEnvironment(process.env, ['LANG', 'PATH', 'LC_ALL']),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_EXTERNAL_DIFF: '/usr/bin/false',
    // Definitive lazy-fetch block: Git documents this as "Setting this Boolean
    // environment variable to true tells Git not to lazily fetch missing
    // objects from the promisor remote on demand."
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function assertTargetRepositoryMatchesPolicy(
  targetRepositoryRoot: string,
  reviewedRepository: string,
): void {
  let canonicalTarget: string;
  try {
    canonicalTarget = fs.realpathSync.native(targetRepositoryRoot);
  } catch {
    throw new GraphifyMaterializerError(
      'UNSAFE_GIT_PATH',
      'Git repository root must resolve inside the reviewed repository boundary',
      'unsafe Git repository root',
    );
  }

  if (canonicalTarget !== reviewedRepository) {
    throw new GraphifyMaterializerError(
      'UNSAFE_GIT_PATH',
      'Git repository root must match the reviewed repository boundary',
      'unsafe Git repository root',
    );
  }
}

function invalidGitRef(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'INVALID_GIT_REF',
    'Git commit identity must be a full immutable SHA pin',
    'invalid immutable Git commit identity',
  );
}

function assertImmutableSha(value: string): void {
  if (!immutableShaPattern.test(value)) {
    throw invalidGitRef();
  }
}

function sanitizedGitError(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'GIT_COMMAND_FAILED',
    'read-only Git command failed',
    'read-only Git command failed',
  );
}

function validateHostGitExecutable(
  policy: GraphifySafetyPolicy | undefined,
): string {
  if (!path.isAbsolute(hostGitExecutable)) {
    throw new GraphifyMaterializerError(
      'INVALID_GIT_EXECUTABLE',
      'Git executable must be a host-owned absolute path',
      'invalid Git executable',
    );
  }

  let canonicalExecutable: string;
  try {
    canonicalExecutable = fs.realpathSync.native(hostGitExecutable);
    const stats = fs.statSync(canonicalExecutable);
    if (!stats.isFile() || (stats.mode & 0o111) === 0) {
      throw new Error('not executable');
    }
  } catch {
    throw new GraphifyMaterializerError(
      'INVALID_GIT_EXECUTABLE',
      'Git executable must resolve to the host Git allowlist entry',
      'invalid Git executable',
    );
  }

  if (!/git(?:\.exe)?$/u.test(path.basename(canonicalExecutable))) {
    throw new GraphifyMaterializerError(
      'INVALID_GIT_EXECUTABLE',
      'Git executable must resolve to the host Git allowlist entry',
      'invalid Git executable',
    );
  }

  if (policy) {
    const roots = assertSafeRoots(policy);
    for (const root of [
      roots.reviewedRepository,
      roots.stagingRoot,
      roots.runStoreRoot,
    ]) {
      if (isSameOrInside(root, canonicalExecutable)) {
        throw new GraphifyMaterializerError(
          'INVALID_GIT_EXECUTABLE',
          'Git executable must not be controlled by the reviewed repository or writable roots',
          'invalid Git executable',
        );
      }
    }
  }

  return canonicalExecutable;
}

function defaultGitRunner(policy?: GraphifySafetyPolicy): GraphifyGitRunner {
  const executable = validateHostGitExecutable(policy);
  if (policy) {
    assertPositiveSafeInteger('timeoutMs', policy.timeoutMs);
    assertPositiveSafeInteger('maxOutputBytes', policy.maxOutputBytes);
  }
  return {
    executable,
    async run(invocation) {
      try {
        const { stdout, stderr } = await execFileAsync(
          invocation.executable,
          [...invocation.argv],
          {
            cwd: invocation.cwd,
            encoding: 'buffer',
            env: invocation.env,
            maxBuffer: policy?.maxOutputBytes ?? 1024 * 1024,
            shell: false,
            timeout: policy?.timeoutMs,
          },
        );
        return {
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
          stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
        };
      } catch {
        throw sanitizedGitError();
      }
    },
  };
}

async function runGit(
  git: GraphifyGitRunner,
  repositoryRoot: string,
  argv: readonly string[],
): Promise<Buffer> {
  try {
    const result = await git.run({
      argv: [...isolatedGitConfigArgv, ...argv],
      cwd: repositoryRoot,
      env: safeGitEnvironment(),
      executable: git.executable,
      shell: false,
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof GraphifyMaterializerError) {
      throw error;
    }
    throw sanitizedGitError();
  }
}

async function runGitCommitIdentity(
  git: GraphifyGitRunner,
  repositoryRoot: string,
  argv: readonly string[],
): Promise<Buffer> {
  try {
    return await runGit(git, repositoryRoot, argv);
  } catch {
    throw invalidGitRef();
  }
}

function parseSingleShaOutput(output: Buffer): string {
  const text = output.toString('utf8').trim();
  if (!immutableShaPattern.test(text)) {
    throw invalidGitRef();
  }
  return text;
}

export async function resolveRepositoryTarget(
  repositoryRoot: string,
  base: string,
  head: string,
  options: ResolveRepositoryTargetOptions = {},
): Promise<RepositoryTarget> {
  assertImmutableSha(base);
  assertImmutableSha(head);

  let executionRepositoryRoot = repositoryRoot;
  if (options.policy) {
    const safeRoots = assertSafeRoots(options.policy);
    assertTargetRepositoryMatchesPolicy(
      repositoryRoot,
      safeRoots.reviewedRepository,
    );
    if (!options.git) {
      executionRepositoryRoot = safeRoots.reviewedRepository;
    }
  }

  const git = options.git ?? defaultGitRunner(options.policy);
  const resolvedBase = parseSingleShaOutput(
    await runGitCommitIdentity(git, executionRepositoryRoot, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${base}^{commit}`,
    ]),
  );
  const resolvedHead = parseSingleShaOutput(
    await runGitCommitIdentity(git, executionRepositoryRoot, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${head}^{commit}`,
    ]),
  );
  const mergeBaseSha = parseSingleShaOutput(
    await runGitCommitIdentity(git, executionRepositoryRoot, [
      'merge-base',
      resolvedBase,
      resolvedHead,
    ]),
  );

  return {
    repositoryRoot: executionRepositoryRoot,
    baseSha: resolvedBase,
    headSha: resolvedHead,
    mergeBaseSha,
  };
}

function malformedNulFraming(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'GIT_COMMAND_FAILED',
    'Git NUL-delimited output is malformed',
    'malformed NUL-delimited Git output',
  );
}

function assertStrictNulFraming(output: Buffer): void {
  if (output.length > 0 && output.at(-1) !== 0) {
    throw malformedNulFraming();
  }
}

function parseNulPaths(output: Buffer): string[] {
  assertStrictNulFraming(output);
  if (output.length === 0) {
    return [];
  }

  let frames: string[];
  try {
    frames = decodeGitBytes(output).split('\0');
  } catch {
    throw malformedNulFraming();
  }
  const records = frames.slice(0, -1);
  if (records.some((entry) => entry.length === 0)) {
    throw malformedNulFraming();
  }
  return records;
}

function decodeGitBytes(output: Buffer): string {
  return new TextDecoder('utf8', { fatal: true }).decode(output);
}

function normalizeGitPath(filePath: string): string {
  return filePath.normalize('NFC');
}

function normalizedGitPathCollision(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'UNSAFE_GIT_PATH',
    'Git changed paths collide after Unicode normalization',
    'normalized Git path collision rejected',
  );
}

function normalizeDistinctGitPaths(
  rawPaths: readonly string[],
): NormalizedGitPath[] {
  const normalizedToRaw = new Map<string, string>();
  const normalizedPaths: NormalizedGitPath[] = [];

  for (const rawPath of rawPaths) {
    const normalizedPath = normalizeGitPath(rawPath);
    const existingRawPath = normalizedToRaw.get(normalizedPath);
    if (existingRawPath !== undefined && existingRawPath !== rawPath) {
      throw normalizedGitPathCollision();
    }
    normalizedToRaw.set(normalizedPath, rawPath);
    normalizedPaths.push({ rawPath, normalizedPath });
  }

  return normalizedPaths;
}

function pathSkipReason(filePath: string): string | undefined {
  if (path.posix.isAbsolute(filePath) || path.isAbsolute(filePath)) {
    return 'absolute_path';
  }

  const normalized = path.posix.normalize(filePath);
  if (
    filePath === '..' ||
    filePath.startsWith('../') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    filePath.includes('/../') ||
    filePath.endsWith('/..')
  ) {
    return 'path_traversal';
  }

  if (filePath === '' || filePath.includes('\0')) {
    return 'invalid_path';
  }

  return undefined;
}

function assertApprovedPaths(
  changedPaths: readonly NormalizedGitPath[],
  approvedPaths: readonly string[],
): void {
  const approved = new Set(
    normalizeDistinctGitPaths(approvedPaths).map(
      (filePath) => filePath.normalizedPath,
    ),
  );
  const unapproved = changedPaths.find(
    (filePath) => !approved.has(filePath.normalizedPath),
  );
  if (!unapproved) {
    return;
  }

  throw new GraphifyMaterializerError(
    'UNAPPROVED_CHANGED_PATH',
    'Git changed path is outside the approved materialization set',
    `unapproved changed path: ${unapproved.normalizedPath}`,
  );
}

function invalidByteLimit(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'MATERIALIZATION_LIMIT_EXCEEDED',
    'Materialization byte limits must be non-negative safe integers',
    'invalid materialization byte limit',
  );
}

function invalidFileLimit(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'MATERIALIZATION_LIMIT_EXCEEDED',
    'Materialization file limit must be a non-negative safe integer',
    'invalid materialization file limit',
  );
}

function assertValidOptionalByteLimit(value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidByteLimit();
  }
}

function assertValidMaterializationLimits(
  options: MaterializeGitFileSetOptions,
): void {
  if (!Number.isSafeInteger(options.maxFiles) || options.maxFiles < 0) {
    throw invalidFileLimit();
  }
  assertValidOptionalByteLimit(options.maxFileBytes);
  assertValidOptionalByteLimit(options.maxBytes);
}

function assertFileLimit(
  changedPaths: readonly NormalizedGitPath[],
  maxFiles: number,
): void {
  if (changedPaths.length <= maxFiles) {
    return;
  }

  throw new GraphifyMaterializerError(
    'MATERIALIZATION_LIMIT_EXCEEDED',
    'Git changed file set exceeds the materialization limit',
    'materialization file-count limit exceeded',
  );
}

function cleanStagingRoot(stagingRoot: string): void {
  try {
    fs.rmSync(stagingRoot, { force: true, recursive: true });
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  } catch {
    throw new GraphifyMaterializerError(
      'STAGING_CLEANUP_FAILED',
      'failed to prepare staging root',
      'staging root cleanup failed',
    );
  }
}

function dirtyGitWorktree(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'DIRTY_GIT_WORKTREE',
    'Git worktree must be clean before materialization',
    'dirty Git worktree rejected',
  );
}

function validateTreeObjectId(objectId: string): void {
  if (!immutableShaPattern.test(objectId)) {
    throw new GraphifyMaterializerError(
      'GIT_COMMAND_FAILED',
      'Git tree output contains a malformed object id',
      'malformed Git tree object id',
    );
  }
}

function malformedTreeOutput(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'GIT_COMMAND_FAILED',
    'Git tree output is malformed',
    'malformed Git tree output',
  );
}

function assertTreePathMatchesRequested(
  returnedPath: string,
  requestedPath: string,
): void {
  if (returnedPath !== requestedPath) {
    throw new GraphifyMaterializerError(
      'UNSAFE_GIT_PATH',
      'Git tree output path does not match the requested path',
      'unsafe Git tree output path',
    );
  }
}

async function assertCleanGitWorktree(
  git: GraphifyGitRunner,
  repositoryRoot: string,
): Promise<void> {
  const status = await runGit(git, repositoryRoot, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
  ]);
  if (status.length > 0) {
    throw dirtyGitWorktree();
  }
}

function partialCloneRejected(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'PARTIAL_CLONE_REJECTED',
    'partial clone repositories are not safe for materialization',
    'partial clone repositories are rejected',
  );
}

/**
 * Reject partial/promise clones before any object read can trigger a lazy
 * fetch. A partial clone sets the local config extension
 * `extensions.partialclone=<remote>` (git stores the key lowercased), and a
 * promisor remote sets `remote.<name>.promisor=true` or
 * `remote.<name>.partialclonefilter=<filter>`. Any of these enable lazy
 * fetching from that remote.
 *
 * We list local config — which always exits 0 for a valid repo, avoiding the
 * exit-1 ambiguity of `git config --get` — and reject if any promisor
 * configuration is present. The probe is routed through `runGit` so that a
 * runner that throws a raw error is subject to the same error sanitization as
 * every other Git call (an unsanitized throw could leak repository paths or
 * runner internals).
 *
 * Note: command-line `-c` overrides (such as our defensive
 * `remote.origin.promisor=false`) do NOT appear in `git config --local --list`
 * output, which reads only `.git/config`. The promisor pattern matches all
 * truthy boolean forms (`true`/`yes`/`on`/`1`) and bare valueless keys, but
 * deliberately does NOT match an explicit `=false`/`=no`/`=off`/`=0`.
 */
async function assertNotPartialClone(
  git: GraphifyGitRunner,
  repositoryRoot: string,
): Promise<void> {
  const output = await runGit(git, repositoryRoot, [
    'config',
    '--local',
    '--list',
  ]);
  const configText = decodeGitBytes(output);
  if (hasPromisorConfiguration(configText)) {
    throw partialCloneRejected();
  }
}

const promisorConfigPatterns: readonly RegExp[] = [
  /(^|\n)extensions\.partialclone=/iu,
  // Match any remote name (Git allows `/`, `@`, etc.) and all truthy boolean
  // forms (`true`/`yes`/`on`/`1`) plus a bare key with no `=` (git-config
  // treats a valueless key as true). The `=value` group is optional so a bare
  // `promisor` key matches; the alternation lists only truthy values, so an
  // explicit `=false`/`=no`/`=off`/`=0` does NOT match (that is our own
  // defensive override). The `(?=\n|$)` lookahead prevents matching a key
  // with a longer suffix such as `promisorfilter`.
  /(^|\n)remote\..+\.promisor(?:=(?:true|yes|on|1))?(?=\n|$)/iu,
  /(^|\n)remote\..+\.partialclonefilter=/iu,
];

function hasPromisorConfiguration(configText: string): boolean {
  for (const pattern of promisorConfigPatterns) {
    if (pattern.test(configText)) {
      return true;
    }
  }
  return false;
}

function parseTreeEntry(
  output: Buffer,
  requestedPath: string,
): TreeEntry | undefined {
  assertStrictNulFraming(output);
  if (output.length === 0) {
    return undefined;
  }

  let frames: string[];
  try {
    frames = decodeGitBytes(output).split('\0');
  } catch {
    throw malformedNulFraming();
  }
  const records = frames.slice(0, -1);
  if (records.length !== 1 || records[0]?.length === 0) {
    throw malformedNulFraming();
  }
  const text = records[0];

  const tabIndex = text.indexOf('\t');
  if (tabIndex === -1) {
    throw malformedTreeOutput();
  }

  const metadata = text.slice(0, tabIndex).split(' ');
  if (metadata.length !== 3) {
    throw malformedTreeOutput();
  }

  const [mode, objectType, objectId] = metadata;
  const filePath = text.slice(tabIndex + 1);
  if (!mode || !objectType || !objectId || !filePath) {
    throw malformedTreeOutput();
  }

  validateTreeObjectId(objectId);
  assertTreePathMatchesRequested(filePath, requestedPath);

  return { mode, objectType, objectId, path: filePath };
}

function isInsideRoot(root: string, candidate: string): boolean {
  return isSameOrInside(root, candidate);
}

function destinationFor(stagingRoot: string, filePath: string): string {
  const destination = path.resolve(stagingRoot, filePath);
  if (!isInsideRoot(stagingRoot, destination)) {
    throw new GraphifyMaterializerError(
      'UNSAFE_GIT_PATH',
      'Git path escapes the materialization staging root',
      'unsafe Git materialization path',
    );
  }
  return destination;
}

function parseObjectSize(output: Buffer): number {
  const text = output.toString('utf8').trim();
  if (!/^\d+$/u.test(text)) {
    throw new GraphifyMaterializerError(
      'GIT_COMMAND_FAILED',
      'Git object size output is malformed',
      'malformed Git object size',
    );
  }
  const size = Number(text);
  if (!Number.isSafeInteger(size)) {
    throw new GraphifyMaterializerError(
      'MATERIALIZATION_LIMIT_EXCEEDED',
      'Git object size exceeds the materialization byte limit',
      'materialization file-byte limit exceeded',
    );
  }
  return size;
}

function fileByteLimitExceeded(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'MATERIALIZATION_LIMIT_EXCEEDED',
    'Git object exceeds the materialization byte limit',
    'materialization file-byte limit exceeded',
  );
}

function totalByteLimitExceeded(): GraphifyMaterializerError {
  return new GraphifyMaterializerError(
    'MATERIALIZATION_LIMIT_EXCEEDED',
    'Git file set exceeds the materialization byte limit',
    'materialization total-byte limit exceeded',
  );
}

async function readObjectSize(
  git: GraphifyGitRunner,
  repositoryRoot: string,
  objectId: string,
): Promise<number> {
  return parseObjectSize(
    await runGit(git, repositoryRoot, ['cat-file', '-s', objectId]),
  );
}

function writeBlobAtomically(
  stagingRoot: string,
  filePath: string,
  content: Buffer,
): void {
  const destination = destinationFor(stagingRoot, filePath);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, destination);
  } catch {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // best-effort cleanup; do not replace the original error
    }
    throw new GraphifyMaterializerError(
      'STAGING_WRITE_FAILED',
      'failed to stage blob',
      'blob staging write failed',
    );
  }
}

function sortPaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function sortSkips(
  skippedFiles: readonly { path: string; reason: string }[],
): { path: string; reason: string }[] {
  const priority = new Map([
    ['absolute_path', 0],
    ['path_traversal', 1],
    ['unsupported_git_mode', 2],
  ]);

  return [...skippedFiles].sort(
    (left, right) =>
      (priority.get(left.reason) ?? 99) - (priority.get(right.reason) ?? 99) ||
      left.path.localeCompare(right.path),
  );
}

export async function materializeGitFileSet(
  target: RepositoryTarget,
  policy: GraphifySafetyPolicy,
  options: MaterializeGitFileSetOptions,
): Promise<MaterializationResult> {
  assertImmutableSha(target.baseSha);
  assertImmutableSha(target.headSha);
  assertImmutableSha(target.mergeBaseSha);
  const safeRoots = assertSafeRoots(policy);
  assertTargetRepositoryMatchesPolicy(
    target.repositoryRoot,
    safeRoots.reviewedRepository,
  );
  const executionRepositoryRoot = options.git
    ? target.repositoryRoot
    : safeRoots.reviewedRepository;
  assertValidMaterializationLimits(options);
  const stagingRoot = safeRoots.stagingRoot;
  const usesDefaultGitRunner = !options.git;
  const git = options.git ?? defaultGitRunner(policy);

  cleanStagingRoot(stagingRoot);

  try {
    await assertNotPartialClone(git, executionRepositoryRoot);

    if (usesDefaultGitRunner) {
      await assertCleanGitWorktree(git, executionRepositoryRoot);
    }

    const changedPaths = normalizeDistinctGitPaths(
      parseNulPaths(
        await runGit(git, executionRepositoryRoot, [
          'diff',
          '--name-only',
          '-z',
          '--no-ext-diff',
          '--no-textconv',
          target.mergeBaseSha,
          target.headSha,
          '--',
        ]),
      ),
    );

    assertApprovedPaths(changedPaths, options.approvedPaths);
    assertFileLimit(changedPaths, options.maxFiles);

    const includedFiles: string[] = [];
    const skippedFiles: { path: string; reason: string }[] = [];
    let materializedBytes = 0;

    for (const { rawPath, normalizedPath } of changedPaths) {
      const unsafeReason = pathSkipReason(normalizedPath);
      if (unsafeReason) {
        skippedFiles.push({ path: normalizedPath, reason: unsafeReason });
        continue;
      }

      const treeEntry = parseTreeEntry(
        await runGit(git, executionRepositoryRoot, [
          'ls-tree',
          '-z',
          '--full-tree',
          target.headSha,
          '--',
          rawPath,
        ]),
        rawPath,
      );

      if (
        !treeEntry ||
        treeEntry.objectType !== 'blob' ||
        !regularBlobModes.has(treeEntry.mode)
      ) {
        skippedFiles.push({
          path: normalizedPath,
          reason: 'unsupported_git_mode',
        });
        continue;
      }

      const objectSize = await readObjectSize(
        git,
        executionRepositoryRoot,
        treeEntry.objectId,
      );
      if (
        options.maxFileBytes !== undefined &&
        objectSize > options.maxFileBytes
      ) {
        throw fileByteLimitExceeded();
      }
      if (
        options.maxBytes !== undefined &&
        materializedBytes + objectSize > options.maxBytes
      ) {
        throw totalByteLimitExceeded();
      }

      const blob = await runGit(git, executionRepositoryRoot, [
        'cat-file',
        'blob',
        treeEntry.objectId,
      ]);
      if (blob.byteLength !== objectSize) {
        throw new GraphifyMaterializerError(
          'GIT_COMMAND_FAILED',
          'Git blob size changed during materialization',
          'unstable Git blob size',
        );
      }
      writeBlobAtomically(stagingRoot, normalizedPath, blob);
      materializedBytes += objectSize;
      includedFiles.push(normalizedPath);
    }

    return {
      stagingRoot,
      includedFiles: sortPaths(includedFiles),
      skippedFiles: sortSkips(skippedFiles),
    };
  } catch (error) {
    try {
      cleanStagingRoot(stagingRoot);
    } catch {
      // best-effort cleanup during error path; preserve the original error
    }
    throw error;
  }
}
