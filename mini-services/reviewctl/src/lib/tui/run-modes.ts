import fs from 'node:fs';
import path from 'node:path';
import {
  AbortExecutionError,
  createTerminalLifecycle,
  signalToExitCode,
} from './lifecycle.js';
import { AlternateScreenRenderer } from './renderer.js';
import { formatSummaryLine } from './summary.js';
import type {
  PhaseSnapshot,
  RunModeOptions,
  RunModeResult,
  SummaryLineInput,
  WorkflowReporter,
} from './types.js';

interface StatusCounts {
  tasks: {
    pending: number;
    done: number;
    failed: number;
  };
  statics: {
    pending: number;
    pass: number;
    fail: number;
    skip: number;
  };
}

function createInitialPhases(): PhaseSnapshot[] {
  return [
    {
      key: 'preconditions',
      label: 'Validating preconditions',
      status: 'PENDING',
      updatedAt: Date.now(),
    },
    {
      key: 'prepare',
      label: 'Preparing run context',
      status: 'PENDING',
      updatedAt: Date.now(),
    },
    {
      key: 'statics',
      label: 'Generating static requests',
      status: 'PENDING',
      updatedAt: Date.now(),
    },
    {
      key: 'agents',
      label: 'Generating agent requests',
      status: 'PENDING',
      updatedAt: Date.now(),
    },
    {
      key: 'finalize',
      label: 'Finalizing run state',
      status: 'PENDING',
      updatedAt: Date.now(),
    },
  ];
}

function readStatusJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    // Log parse errors but don't crash - corrupted status files shouldn't halt the TUI
    if (process.stderr.isTTY) {
      process.stderr.write(
        `[reviewctl] warning: failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return null;
  }
}

function collectCounts(runDir: string): StatusCounts {
  const emptyCounts = (): StatusCounts => ({
    tasks: { pending: 0, done: 0, failed: 0 },
    statics: { pending: 0, pass: 0, fail: 0, skip: 0 },
  });

  try {
    const tasksDir = path.join(runDir, 'tasks');
    const staticsDir = path.join(runDir, 'statics');

    const counts = emptyCounts();

    if (fs.existsSync(tasksDir)) {
      const taskEntries = fs.readdirSync(tasksDir, { withFileTypes: true });
      for (const entry of taskEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const statusPath = path.join(tasksDir, entry.name, 'status.json');
        const payload = readStatusJson(statusPath);
        const status = String(payload?.status || 'PENDING').toUpperCase();
        if (status === 'DONE' || status === 'PASS') {
          counts.tasks.done += 1;
        } else if (status === 'FAIL' || status === 'FAILED') {
          counts.tasks.failed += 1;
        } else {
          counts.tasks.pending += 1;
        }
      }
    }

    if (fs.existsSync(staticsDir)) {
      const staticFiles = fs
        .readdirSync(staticsDir)
        .filter((name) => name.endsWith('_status.json'));

      for (const fileName of staticFiles) {
        const payload = readStatusJson(path.join(staticsDir, fileName));
        const status = String(payload?.status || 'PENDING').toUpperCase();
        if (status === 'PASS') {
          counts.statics.pass += 1;
        } else if (status === 'FAIL' || status === 'FAILED') {
          counts.statics.fail += 1;
        } else if (status === 'SKIP') {
          counts.statics.skip += 1;
        } else {
          counts.statics.pending += 1;
        }
      }
    }

    return counts;
  } catch (error) {
    // Directory read failure shouldn't crash the TUI - return zeros
    if (process.stderr.isTTY) {
      process.stderr.write(
        `[reviewctl] warning: failed to collect counts from ${runDir}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return emptyCounts();
  }
}

function updatePhase(phases: PhaseSnapshot[], phase: PhaseSnapshot): void {
  const index = phases.findIndex((entry) => entry.key === phase.key);
  if (index >= 0) {
    phases[index] = phase;
    return;
  }
  phases.push(phase);
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

function writeErrorArtifact(
  runDir: string | null,
  commandName: string,
  error: unknown,
  phase: string,
): string | undefined {
  if (!runDir) {
    return undefined;
  }

  const errorPath = path.join(runDir, 'error.json');
  const payload = {
    command: commandName,
    code: 'RUN_FAILED',
    message: error instanceof Error ? error.message : String(error),
    phase,
    timestamp: new Date().toISOString(),
    artifact_path: errorPath,
  };
  fs.writeFileSync(errorPath, safeStringify(payload));

  return path.relative(process.cwd(), errorPath);
}

export async function runWithPlainOutput<T>(
  options: RunModeOptions<T>,
): Promise<RunModeResult<T>> {
  const startedAt = Date.now();
  const phases = createInitialPhases();
  let runId = 'unknown';
  let runDir: string | null = null;
  let currentPhase = 'preconditions';

  const lifecycle = createTerminalLifecycle({ cleanup: () => undefined });

  const reporter: WorkflowReporter = {
    setRunMeta(meta) {
      runId = meta.runId;
      runDir = meta.runDir;
    },
    setPhase(phase) {
      currentPhase = phase.key;
      updatePhase(phases, {
        key: phase.key,
        label: phase.label,
        status: phase.status,
        detail: phase.detail,
        updatedAt: Date.now(),
      });
      const detailSuffix = phase.detail ? ` (${phase.detail})` : '';
      console.log(`[reviewctl] ${phase.label}: ${phase.status}${detailSuffix}`);
    },
    throwIfAborted() {
      lifecycle.throwIfAborted();
    },
    log(message: string) {
      console.log(message);
    },
  };

  console.log(`[reviewctl] ${options.commandName} plain output mode`);

  try {
    const data = await options.execute(reporter);
    const durationMs = Date.now() - startedAt;
    console.log(
      formatSummaryLine({
        commandName: options.commandName,
        runId,
        state: 'NO_TTY_FALLBACK',
        durationMs,
      }),
    );

    return {
      exitCode: 0,
      finalState: 'NO_TTY_FALLBACK',
      durationMs,
      runId,
      data,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof AbortExecutionError) {
      console.log(
        formatSummaryLine({
          commandName: options.commandName,
          runId,
          state: 'ABORTED',
          durationMs,
        }),
      );
      return {
        exitCode: signalToExitCode(error.signal),
        finalState: 'ABORTED',
        durationMs,
        runId,
      };
    }

    const errorArtifactPath = writeErrorArtifact(
      runDir,
      options.commandName,
      error,
      currentPhase,
    );
    console.log(
      formatSummaryLine({
        commandName: options.commandName,
        runId,
        state: 'FAILED',
        durationMs,
        errorArtifactPath,
      }),
    );

    return {
      exitCode: 1,
      finalState: 'FAILED',
      durationMs,
      runId,
    };
  } finally {
    lifecycle.dispose();
    lifecycle.cleanup();
  }
}

export async function runWithTUI<T>(
  options: RunModeOptions<T>,
): Promise<RunModeResult<T>> {
  const startedAt = Date.now();
  const renderer = new AlternateScreenRenderer();
  const phases = createInitialPhases();
  let runId = 'unknown';
  let runDir: string | null = null;
  let currentPhase = 'preconditions';
  let summaryInput: SummaryLineInput | null = null;

  const lifecycle = createTerminalLifecycle({
    cleanup: () => renderer.cleanup(),
  });

  const reporter: WorkflowReporter = {
    setRunMeta(meta) {
      runId = meta.runId;
      runDir = meta.runDir;
    },
    setPhase(phase) {
      currentPhase = phase.key;
      updatePhase(phases, {
        key: phase.key,
        label: phase.label,
        status: phase.status,
        detail: phase.detail,
        updatedAt: Date.now(),
      });
    },
    throwIfAborted() {
      lifecycle.throwIfAborted();
    },
    log(_message: string) {
      // No-op in TUI mode; summary line is emitted on teardown.
    },
  };

  const getCounts = () =>
    runDir
      ? collectCounts(runDir)
      : {
          tasks: { pending: 0, done: 0, failed: 0 },
          statics: { pending: 0, pass: 0, fail: 0, skip: 0 },
        };

  const renderSnapshot = () => {
    const counts = getCounts();
    renderer.render({
      commandName: options.commandName,
      runId,
      startedAt,
      phases,
      taskCounts: counts.tasks,
      staticCounts: counts.statics,
    });
  };

  renderer.start();
  renderSnapshot();

  const pollInterval = setInterval(
    renderSnapshot,
    options.pollIntervalMs ?? 1000,
  );

  try {
    const data = await options.execute(reporter);
    renderSnapshot();

    // Show final completed state
    const finalCounts = getCounts();
    renderer.renderFinal(
      {
        commandName: options.commandName,
        runId,
        startedAt,
        phases,
        taskCounts: finalCounts.tasks,
        staticCounts: finalCounts.statics,
      },
      'COMPLETED',
    );

    const successDelay = options.successDelayMs ?? 1500;
    if (successDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, successDelay));
    }

    const durationMs = Date.now() - startedAt;
    summaryInput = {
      commandName: options.commandName,
      runId,
      state: 'COMPLETED',
      durationMs,
    };

    return {
      exitCode: 0,
      finalState: 'COMPLETED',
      durationMs,
      runId,
      data,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof AbortExecutionError) {
      renderer.renderFinal(
        {
          commandName: options.commandName,
          runId,
          startedAt,
          phases,
          taskCounts: { pending: 0, done: 0, failed: 0 },
          staticCounts: { pending: 0, pass: 0, fail: 0, skip: 0 },
        },
        'ABORTED',
      );

      await new Promise((resolve) => setTimeout(resolve, 800));

      summaryInput = {
        commandName: options.commandName,
        runId,
        state: 'ABORTED',
        durationMs,
      };

      return {
        exitCode: signalToExitCode(error.signal),
        finalState: 'ABORTED',
        durationMs,
        runId,
      };
    }

    const errorArtifactPath = writeErrorArtifact(
      runDir,
      options.commandName,
      error,
      currentPhase,
    );

    const errorCounts = getCounts();
    renderer.renderFinal(
      {
        commandName: options.commandName,
        runId,
        startedAt,
        phases,
        taskCounts: errorCounts.tasks,
        staticCounts: errorCounts.statics,
      },
      'FAILED',
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));

    summaryInput = {
      commandName: options.commandName,
      runId,
      state: 'FAILED',
      durationMs,
      errorArtifactPath,
    };

    return {
      exitCode: 1,
      finalState: 'FAILED',
      durationMs,
      runId,
    };
  } finally {
    clearInterval(pollInterval);
    lifecycle.dispose();
    lifecycle.cleanup();

    if (!summaryInput && lifecycle.getAbortSignal()) {
      summaryInput = {
        commandName: options.commandName,
        runId,
        state: 'ABORTED',
        durationMs: Date.now() - startedAt,
      };
    }

    if (summaryInput) {
      console.log(formatSummaryLine(summaryInput));
    }
  }
}
