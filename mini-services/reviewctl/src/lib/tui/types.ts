export type LogicalRunState =
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED'
  | 'NO_TTY_FALLBACK';

export type PhaseStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface PhaseSnapshot {
  key: string;
  label: string;
  status: PhaseStatus;
  detail?: string;
  updatedAt: number;
}

export interface RunSnapshot {
  commandName: string;
  runId: string;
  startedAt: number;
  phases: PhaseSnapshot[];
  taskCounts: {
    pending: number;
    done: number;
    failed: number;
  };
  staticCounts: {
    pending: number;
    pass: number;
    fail: number;
    skip: number;
  };
}

export interface SummaryLineInput {
  commandName: string;
  runId: string;
  state: Exclude<LogicalRunState, 'RUNNING'>;
  durationMs: number;
  errorArtifactPath?: string;
}

export interface WorkflowReporter {
  setRunMeta(meta: { runId: string; runDir: string }): void;
  setPhase(phase: {
    key: string;
    label: string;
    status: PhaseStatus;
    detail?: string;
  }): void;
  throwIfAborted(): void;
  log(message: string): void;
}

export type KeyAction = 'quit' | 'refresh' | 'abort';

export interface KeypressHandler {
  start(): void;
  dispose(): void;
}

export interface RunModeOptions<T> {
  commandName: string;
  execute: (reporter: WorkflowReporter) => Promise<T>;
  pollIntervalMs?: number;
  /** Delay after successful execution before exiting TUI (default: 0) */
  successDelayMs?: number;
  onKeypress?: (key: string, action: KeyAction) => void;
}

export interface RunModeResult<T> {
  exitCode: number;
  finalState: Exclude<LogicalRunState, 'RUNNING'>;
  durationMs: number;
  runId: string;
  data?: T;
}
