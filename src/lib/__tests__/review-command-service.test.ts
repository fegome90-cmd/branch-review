import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandPayload,
  ReviewCommandError,
  ReviewCommandService,
} from '../review-command-service';

const validPayload: CommandPayload = {
  command: 'plan',
  args: {},
};

describe('ReviewCommandService', () => {
  it('enforces rate limiting with 429', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    for (let index = 0; index < 10; index += 1) {
      const result = await service.execute(validPayload, {
        clientId: 'same-client',
      });
      expect(result.output).toBe('ok');
    }

    await expect(
      service.execute(validPayload, { clientId: 'same-client' }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('prevents concurrent execution with 409', async () => {
    let release = () => {};
    const runnerPromise = new Promise<{
      ok: boolean;
      output: string;
      timedOut: boolean;
    }>((resolve) => {
      release = () => resolve({ ok: true, output: 'done', timedOut: false });
    });

    const service = new ReviewCommandService(async () => runnerPromise);

    const first = service.execute(validPayload, { clientId: 'a' });
    await expect(
      service.execute(validPayload, { clientId: 'b' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'COMMAND_IN_PROGRESS',
    });

    release();
    await expect(first).resolves.toMatchObject({ output: 'done' });
  });

  it('maps failed command to typed service error', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: false,
      output: 'boom',
      timedOut: false,
    }));

    let capturedError: unknown;
    try {
      await service.execute(validPayload, { clientId: 'client' });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ReviewCommandError);
    expect((capturedError as ReviewCommandError).status).toBe(500);
    expect((capturedError as ReviewCommandError).code).toBe('COMMAND_FAILED');
  });
});

describe('Multi-repo validation', () => {
  let tempDir: string;
  let realDir: string;
  let symlinkDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `repo-test-${Date.now()}`);
    realDir = join(tempDir, 'real-repo');
    symlinkDir = join(tempDir, 'symlink-repo');

    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'test.txt'), 'test');
  });

  afterEach(() => {
    try {
      if (existsSync(symlinkDir)) {
        unlinkSync(symlinkDir);
      }
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup on best effort
    }
  });

  it('rejects non-existent repo path with REPO_NOT_FOUND', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    let capturedError: unknown;
    try {
      await service.execute(validPayload, {
        clientId: 'client',
        repoPath: '/nonexistent/path/12345',
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ReviewCommandError);
    expect((capturedError as ReviewCommandError).status).toBe(404);
    expect((capturedError as ReviewCommandError).code).toBe('REPO_NOT_FOUND');
  });

  it('rejects path traversal attempts with REPO_NOT_ALLOWED', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    let capturedError: unknown;
    try {
      await service.execute(validPayload, {
        clientId: 'client',
        repoPath: '/tmp/../etc/passwd',
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ReviewCommandError);
    expect((capturedError as ReviewCommandError).status).toBe(403);
    expect((capturedError as ReviewCommandError).code).toBe('REPO_NOT_ALLOWED');
  });

  it('allows symlink to existing directory', async () => {
    // Create symlink
    symlinkSync(realDir, symlinkDir);

    // Verify symlink exists and points to real dir
    // Note: macOS resolves /var to /private/var, so we compare resolved paths
    expect(existsSync(symlinkDir)).toBe(true);
    expect(realpathSync(symlinkDir)).toBe(realpathSync(realDir));

    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    // Without whitelist, symlink should be allowed
    const originalEnv = process.env.ALLOWED_REPOS;
    process.env.ALLOWED_REPOS = '';

    try {
      const result = await service.execute(validPayload, {
        clientId: 'client',
        repoPath: symlinkDir,
      });
      expect(result.output).toBe('ok');
    } finally {
      process.env.ALLOWED_REPOS = originalEnv;
    }
  });

  it('respects ALLOWED_REPOS whitelist', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    const originalEnv = process.env.ALLOWED_REPOS;

    // Set whitelist to only allow tempDir
    process.env.ALLOWED_REPOS = tempDir;

    try {
      // Should succeed - path is under whitelist
      const result = await service.execute(validPayload, {
        clientId: 'client',
        repoPath: realDir,
      });
      expect(result.output).toBe('ok');

      // Should fail - path not under whitelist
      let capturedError: unknown;
      try {
        await service.execute(validPayload, {
          clientId: 'client',
          repoPath: '/etc',
        });
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toBeInstanceOf(ReviewCommandError);
      expect((capturedError as ReviewCommandError).status).toBe(403);
      expect((capturedError as ReviewCommandError).code).toBe(
        'REPO_NOT_ALLOWED',
      );
    } finally {
      process.env.ALLOWED_REPOS = originalEnv;
    }
  });

  it('handles symlink outside whitelist', async () => {
    // Create symlink
    symlinkSync(realDir, symlinkDir);

    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: 'ok',
      timedOut: false,
    }));

    const originalEnv = process.env.ALLOWED_REPOS;

    // Set whitelist to something that doesn't include the real path
    process.env.ALLOWED_REPOS = '/nonexistent';

    try {
      let capturedError: unknown;
      try {
        await service.execute(validPayload, {
          clientId: 'client',
          repoPath: symlinkDir,
        });
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toBeInstanceOf(ReviewCommandError);
      expect((capturedError as ReviewCommandError).status).toBe(403);
      expect((capturedError as ReviewCommandError).code).toBe(
        'REPO_NOT_ALLOWED',
      );
    } finally {
      process.env.ALLOWED_REPOS = originalEnv;
    }
  });
});

describe('Buffer truncation', () => {
  it('truncates large output to MAX_OUTPUT_CHARS', async () => {
    const largeOutput = 'x'.repeat(20000);

    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: largeOutput,
      timedOut: false,
    }));

    const result = await service.execute(validPayload, { clientId: 'client' });

    expect(result.output.length).toBeLessThanOrEqual(12000 + 20); // +20 for truncation message
    expect(result.output).toContain('... [truncated]');
  });

  it('preserves small output unchanged', async () => {
    const smallOutput = 'small output';

    const service = new ReviewCommandService(async () => ({
      ok: true,
      output: smallOutput,
      timedOut: false,
    }));

    const result = await service.execute(validPayload, { clientId: 'client' });

    expect(result.output).toBe(smallOutput);
    expect(result.output).not.toContain('[truncated]');
  });
});

describe('PR command', () => {
  it('returns success for PR_EXISTS (idempotent)', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: false,
      output: 'Error code: PR_EXISTS\nhttps://github.com/org/repo/pull/1',
      timedOut: false,
    }));

    const result = await service.execute(
      { command: 'pr', args: { title: 'Test PR', body: 'Test body' } },
      { clientId: 'client' },
    );

    expect(result.output).toBe('PR already exists');
    expect(result.code).toBe('PR_EXISTS');
  });

  it('throws error for GH_NOT_AUTHENTICATED', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: false,
      output: 'Error code: GH_NOT_AUTHENTICATED',
      timedOut: false,
    }));

    let capturedError: unknown;
    try {
      await service.execute(
        { command: 'pr', args: { title: 'Test', body: 'Body' } },
        { clientId: 'client' },
      );
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ReviewCommandError);
    expect((capturedError as ReviewCommandError).status).toBe(503);
    expect((capturedError as ReviewCommandError).code).toBe(
      'GH_NOT_AUTHENTICATED',
    );
  });

  it('throws error for NO_COMMITS', async () => {
    const service = new ReviewCommandService(async () => ({
      ok: false,
      output: 'Error code: NO_COMMITS',
      timedOut: false,
    }));

    let capturedError: unknown;
    try {
      await service.execute(
        { command: 'pr', args: { title: 'Test', body: 'Body' } },
        { clientId: 'client' },
      );
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ReviewCommandError);
    expect((capturedError as ReviewCommandError).status).toBe(400);
    expect((capturedError as ReviewCommandError).code).toBe('NO_COMMITS');
  });
});
