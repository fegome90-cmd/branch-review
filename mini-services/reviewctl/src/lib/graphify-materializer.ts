import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertSafeRoots,
  createMinimalEnvironment,
  type GraphifySafetyPolicy,
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
  | 'INVALID_GIT_REF'
  | 'MATERIALIZATION_LIMIT_EXCEEDED'
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
}

type TreeEntry = {
  mode: string;
  objectType: string;
  objectId: string;
  path: string;
};

const hostGitExecutable = process.env.GIT_EXECUTABLE ?? '/usr/bin/git';
const immutableShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const regularBlobModes = new Set(['100644', '100755']);

function safeGitEnvironment(): NodeJS.ProcessEnv {
  return createMinimalEnvironment(process.env, ['LANG', 'PATH']);
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

function defaultGitRunner(policy?: GraphifySafetyPolicy): GraphifyGitRunner {
  return {
    executable: hostGitExecutable,
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
      argv: [...argv],
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

function parseNulPaths(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length > 0);
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
  changedPaths: readonly string[],
  approvedPaths: readonly string[],
): void {
  const approved = new Set(approvedPaths);
  const unapproved = changedPaths.find((filePath) => !approved.has(filePath));
  if (!unapproved) {
    return;
  }

  throw new GraphifyMaterializerError(
    'UNAPPROVED_CHANGED_PATH',
    'Git changed path is outside the approved materialization set',
    `unapproved changed path: ${unapproved}`,
  );
}

function assertFileLimit(
  changedPaths: readonly string[],
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
  fs.rmSync(stagingRoot, { force: true, recursive: true });
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
}

function cleanupRejectedEmptyStagingRoot(policy: GraphifySafetyPolicy): void {
  if (!path.isAbsolute(policy.stagingRoot)) {
    return;
  }

  try {
    const stagingRoot = path.resolve(policy.stagingRoot);
    const stats = fs.lstatSync(stagingRoot);
    if (stats.isDirectory() && fs.readdirSync(stagingRoot).length === 0) {
      fs.rmdirSync(stagingRoot);
    }
  } catch {
    // Best-effort restoration for a rejected caller-provided staging root.
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

function parseTreeEntry(
  output: Buffer,
  requestedPath: string,
): TreeEntry | undefined {
  const text = output.toString('utf8').replace(/\0$/u, '');
  if (text.length === 0) {
    return undefined;
  }

  const tabIndex = text.indexOf('\t');
  if (tabIndex === -1) {
    return undefined;
  }

  const metadata = text.slice(0, tabIndex).split(' ');
  if (metadata.length !== 3) {
    return undefined;
  }

  const [mode, objectType, objectId] = metadata;
  const filePath = text.slice(tabIndex + 1);
  if (!mode || !objectType || !objectId || !filePath) {
    return undefined;
  }

  validateTreeObjectId(objectId);
  assertTreePathMatchesRequested(filePath, requestedPath);

  return { mode, objectType, objectId, path: filePath };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
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

function writeBlobAtomically(
  stagingRoot: string,
  filePath: string,
  content: Buffer,
): void {
  const destination = destinationFor(stagingRoot, filePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, destination);
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
  let executionRepositoryRoot: string;
  try {
    const safeRoots = assertSafeRoots(policy);
    assertTargetRepositoryMatchesPolicy(
      target.repositoryRoot,
      safeRoots.reviewedRepository,
    );
    executionRepositoryRoot = options.git
      ? target.repositoryRoot
      : safeRoots.reviewedRepository;
  } catch (error) {
    cleanupRejectedEmptyStagingRoot(policy);
    throw error;
  }
  const stagingRoot = path.resolve(policy.stagingRoot);
  const usesDefaultGitRunner = !options.git;
  const git = options.git ?? defaultGitRunner(policy);

  cleanStagingRoot(stagingRoot);

  try {
    if (usesDefaultGitRunner) {
      await assertCleanGitWorktree(git, executionRepositoryRoot);
    }

    const changedPaths = parseNulPaths(
      await runGit(git, executionRepositoryRoot, [
        'diff',
        '--name-only',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        target.baseSha,
        target.headSha,
        '--',
      ]),
    );

    assertApprovedPaths(changedPaths, options.approvedPaths);
    assertFileLimit(changedPaths, options.maxFiles);

    const includedFiles: string[] = [];
    const skippedFiles: { path: string; reason: string }[] = [];

    for (const filePath of changedPaths) {
      const unsafeReason = pathSkipReason(filePath);
      if (unsafeReason) {
        skippedFiles.push({ path: filePath, reason: unsafeReason });
        continue;
      }

      const treeEntry = parseTreeEntry(
        await runGit(git, executionRepositoryRoot, [
          'ls-tree',
          '-z',
          '--full-tree',
          target.headSha,
          '--',
          filePath,
        ]),
        filePath,
      );

      if (
        !treeEntry ||
        treeEntry.objectType !== 'blob' ||
        !regularBlobModes.has(treeEntry.mode)
      ) {
        skippedFiles.push({ path: filePath, reason: 'unsupported_git_mode' });
        continue;
      }

      const blob = await runGit(git, executionRepositoryRoot, [
        'cat-file',
        'blob',
        treeEntry.objectId,
      ]);
      writeBlobAtomically(stagingRoot, filePath, blob);
      includedFiles.push(filePath);
    }

    return {
      stagingRoot,
      includedFiles: sortPaths(includedFiles),
      skippedFiles: sortSkips(skippedFiles),
    };
  } catch (error) {
    cleanStagingRoot(stagingRoot);
    throw error;
  }
}
