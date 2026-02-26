import { describe, expect, it } from 'bun:test';
import {
  ReviewCommandError,
  ReviewCommandService,
  type CommandPayload,
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
      const result = await service.execute(validPayload, { clientId: 'same-client' });
      expect(result.output).toBe('ok');
    }

    await expect(service.execute(validPayload, { clientId: 'same-client' })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('prevents concurrent execution with 409', async () => {
    let release = () => {};
    const runnerPromise = new Promise<{ ok: boolean; output: string; timedOut: boolean }>((resolve) => {
      release = () => resolve({ ok: true, output: 'done', timedOut: false });
    });

    const service = new ReviewCommandService(async () => runnerPromise);

    const first = service.execute(validPayload, { clientId: 'a' });
    await expect(service.execute(validPayload, { clientId: 'b' })).rejects.toMatchObject({
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
