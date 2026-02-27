import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

const COMMAND_TIMEOUT_MS = 120000;
const MAX_OUTPUT_CHARS = 12000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60000;

export const ALLOWED_COMMANDS = [
  'init',
  'explore',
  'plan',
  'run',
  'ingest',
  'merge',
  'cleanup',
  'verdict',
] as const;

export const commandSchema = z.object({
  command: z.enum(ALLOWED_COMMANDS),
  args: z
    .record(
      z.string().regex(/^[a-zA-Z0-9-]+$/),
      z.union([z.string().max(500), z.number(), z.boolean()]),
    )
    .default({})
    .refine((args) => Object.keys(args).length <= 20, 'Too many args (max 20)'),
});

export type CommandPayload = z.infer<typeof commandSchema>;

type CommandResult = {
  ok: boolean;
  output: string;
  timedOut: boolean;
};

type CommandRunner = (
  cliArgs: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

type ExecuteContext = {
  clientId: string;
};

export class ReviewCommandError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, ReviewCommandError.prototype);
  }
}

class InMemoryRateLimiter {
  private requests = new Map<string, number[]>();

  isAllowed(identifier: string, now: number) {
    const timestamps = this.requests.get(identifier) || [];
    const recent = timestamps.filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    );

    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
      this.requests.set(identifier, recent);
      return false;
    }

    recent.push(now);
    this.requests.set(identifier, recent);
    return true;
  }

  reset() {
    this.requests.clear();
  }
}

function toCliArgs(args: Record<string, string | number | boolean>): string[] {
  const cliArgs: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === true) {
      cliArgs.push(`--${key}`);
      continue;
    }

    if (value === false) {
      continue;
    }

    cliArgs.push(`--${key}`, String(value));
  }

  return cliArgs;
}

function trimOutput(output: string) {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }

  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated]`;
}

async function runReviewctl(
  cliArgs: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', cliArgs, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const output =
        (stdout || stderr).trim() || `Command failed with exit code ${code}`;
      resolve({ ok: code === 0, output, timedOut });
    });
  });
}

export class ReviewCommandService {
  private limiter = new InMemoryRateLimiter();
  private running = false;

  constructor(private readonly runner: CommandRunner = runReviewctl) {}

  async execute(payload: CommandPayload, context: ExecuteContext) {
    const now = Date.now();
    if (!this.limiter.isAllowed(context.clientId, now)) {
      throw new ReviewCommandError(429, 'RATE_LIMITED', 'Rate limit exceeded');
    }

    if (this.running) {
      throw new ReviewCommandError(
        409,
        'COMMAND_IN_PROGRESS',
        'Another command is already running',
      );
    }

    this.running = true;

    try {
      const cliPath = path.join(
        process.cwd(),
        'mini-services',
        'reviewctl',
        'src',
        'index.ts',
      );
      const cliArgs = [cliPath, payload.command, ...toCliArgs(payload.args)];
      const result = await this.runner(cliArgs, COMMAND_TIMEOUT_MS);
      const output = trimOutput(result.output || '');

      if (!result.ok && result.timedOut) {
        throw new ReviewCommandError(
          503,
          'COMMAND_TIMEOUT',
          'Command execution timed out',
          { output },
        );
      }

      if (!result.ok) {
        throw new ReviewCommandError(500, 'COMMAND_FAILED', 'Command failed', {
          output,
        });
      }

      return { output: output || 'Command completed successfully' };
    } catch (error) {
      if (error instanceof ReviewCommandError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Command execution failed';
      throw new ReviewCommandError(500, 'COMMAND_EXECUTION_ERROR', message);
    } finally {
      this.running = false;
    }
  }

  resetForTests() {
    this.running = false;
    this.limiter.reset();
  }
}

export const reviewCommandService = new ReviewCommandService();
