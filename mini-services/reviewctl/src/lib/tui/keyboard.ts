export type KeyHandler = () => void;

export interface KeyboardInputConfig {
  onQuit?: KeyHandler;
  onRefresh?: KeyHandler;
  onCustom?: Map<string, KeyHandler>;
}

export interface KeyboardInput {
  start(): void;
  dispose(): void;
}

/**
 * Creates a keyboard input handler for TUI mode.
 * Uses raw mode to capture keystrokes without requiring Enter.
 */
export function createKeyboardInput(
  config: KeyboardInputConfig,
): KeyboardInput {
  let disposed = false;
  let rawModeEnabled = false;

  const enableRawMode = () => {
    if (rawModeEnabled) return;
    rawModeEnabled = true;

    // Enable raw mode - keystrokes are sent immediately
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
  };

  const disableRawMode = () => {
    if (!rawModeEnabled) return;
    rawModeEnabled = false;

    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  };

  const handleKeypress = (key: string) => {
    if (disposed) return;

    switch (key) {
      case 'q':
        config.onQuit?.();
        break;
      case 'r':
        config.onRefresh?.();
        break;
      default:
        config.onCustom?.get(key)?.();
        break;
    }
  };

  const onData = (data: Buffer) => {
    if (disposed) return;
    const key = data.toString('utf-8');
    handleKeypress(key);
  };

  const start = () => {
    enableRawMode();
    process.stdin.on('data', onData);
    process.stdin.resume();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disableRawMode();
    process.stdin.off('data', onData);
    process.stdin.pause();
  };

  return {
    start,
    dispose,
  };
}
