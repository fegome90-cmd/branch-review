export class AbortExecutionError extends Error {
  readonly signal: NodeJS.Signals;

  constructor(signal: NodeJS.Signals) {
    super(`Execution aborted by ${signal}`);
    this.name = 'AbortExecutionError';
    this.signal = signal;
    Object.setPrototypeOf(this, AbortExecutionError.prototype);
  }
}

export function signalToExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGTERM' ? 143 : 130;
}

export function createTerminalLifecycle(options: {
  cleanup: () => void;
  onAbort?: (signal: NodeJS.Signals) => void;
}) {
  let cleaned = false;
  let disposed = false;
  let abortSignal: NodeJS.Signals | null = null;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    options.cleanup();
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    abortSignal = signal;
    options.onAbort?.(signal);
    cleanup();
  };

  const requestAbort = (signal: NodeJS.Signals = 'SIGINT') => {
    if (abortSignal) {
      return;
    }
    handleSignal(signal);
  };

  const onSigInt = () => handleSignal('SIGINT');
  const onSigTerm = () => handleSignal('SIGTERM');

  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);
  process.on('exit', cleanup);

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    process.off('exit', cleanup);
  };

  return {
    cleanup,
    dispose,
    requestAbort,
    getAbortSignal: () => abortSignal,
    throwIfAborted: () => {
      if (abortSignal) {
        throw new AbortExecutionError(abortSignal);
      }
    },
  };
}
