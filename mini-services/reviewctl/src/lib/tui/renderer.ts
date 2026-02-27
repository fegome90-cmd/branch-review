import type { PhaseStatus, RunSnapshot } from './types.js';

// Design direction: Precision & Density
// Terminal-native, monochrome base, color for meaning only

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ANSI color codes (used sparingly for status only)
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function phaseBadge(
  status: PhaseStatus,
  frame: string,
): { symbol: string; color: string } {
  switch (status) {
    case 'DONE':
      return { symbol: '✔', color: ANSI.green };
    case 'FAILED':
      return { symbol: '✘', color: ANSI.red };
    case 'RUNNING':
      return { symbol: frame, color: ANSI.cyan };
    default:
      return { symbol: '○', color: ANSI.dim };
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Best-effort stdout write - silently ignores errors if stdout is closed.
 */
function safeStdoutWrite(data: string): void {
  try {
    if (process.stdout.writable) {
      process.stdout.write(data);
    }
  } catch {
    // Silently ignore - stdout may be closed in piped scenarios
  }
}

export class AlternateScreenRenderer {
  private frameIndex = 0;
  private active = false;

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    safeStdoutWrite('\x1b[?1049h'); // Enter alternate screen
    safeStdoutWrite('\x1b[?25l'); // Hide cursor
  }

  render(snapshot: RunSnapshot): void {
    if (!this.active) {
      return;
    }

    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex += 1;

    const elapsed = formatElapsed(Date.now() - snapshot.startedAt);
    const timestamp = formatTimestamp();

    // Build header
    const lines: string[] = [];
    lines.push('');
    lines.push(
      `  ${ANSI.bold}reviewctl${ANSI.reset} ${snapshot.commandName}  ${ANSI.dim}${timestamp}${ANSI.reset}`,
    );
    lines.push(
      `  ${ANSI.dim}run:${ANSI.reset} ${snapshot.runId}  ${ANSI.dim}elapsed:${ANSI.reset} ${elapsed}`,
    );
    lines.push('');

    // Phase section
    lines.push(`  ${ANSI.dim}phases${ANSI.reset}`);
    for (const phase of snapshot.phases) {
      const badge = phaseBadge(phase.status, frame);
      const detail = phase.detail
        ? ` ${ANSI.dim}— ${phase.detail}${ANSI.reset}`
        : '';
      const elapsedStr =
        phase.status === 'RUNNING' && phase.updatedAt
          ? ` ${ANSI.dim}[${formatElapsed(Date.now() - phase.updatedAt)}]${ANSI.reset}`
          : '';
      lines.push(
        `  ${badge.color}${badge.symbol}${ANSI.reset} ${phase.label}${detail}${elapsedStr}`,
      );
    }
    lines.push('');

    // Metrics section - side by side
    const tasksLabel = 'tasks';
    const staticsLabel = 'statics';
    const tasksValue = `pending:${snapshot.taskCounts.pending} done:${snapshot.taskCounts.done} fail:${snapshot.taskCounts.failed}`;
    const staticsValue = `pending:${snapshot.staticCounts.pending} pass:${snapshot.staticCounts.pass} fail:${snapshot.staticCounts.fail}`;

    lines.push(`  ${ANSI.dim}${tasksLabel}${ANSI.reset}   ${tasksValue}`);
    lines.push(`  ${ANSI.dim}${staticsLabel}${ANSI.reset} ${staticsValue}`);
    lines.push('');

    // Footer - keyboard shortcuts
    lines.push(
      `  ${ANSI.dim}────────────────────────────────────────────────────────────────────${ANSI.reset}`,
    );
    lines.push(
      `  ${ANSI.dim}ctrl+c${ANSI.reset} abort  ${ANSI.dim}q${ANSI.reset} quit`,
    );

    // Render
    safeStdoutWrite('\x1b[2J\x1b[H'); // Clear and home
    safeStdoutWrite(`${lines.join('\n')}\n`);
  }

  /**
   * Render final state before exit (shown briefly before cleanup)
   */
  renderFinal(
    snapshot: RunSnapshot,
    state: 'COMPLETED' | 'FAILED' | 'ABORTED',
  ): void {
    if (!this.active) {
      return;
    }

    const elapsed = formatElapsed(Date.now() - snapshot.startedAt);

    const lines: string[] = [];
    lines.push('');

    const stateConfig = {
      COMPLETED: { symbol: '✔', color: ANSI.green, label: 'completed' },
      FAILED: { symbol: '✘', color: ANSI.red, label: 'failed' },
      ABORTED: { symbol: '◐', color: ANSI.yellow, label: 'aborted' },
    }[state];

    lines.push(
      `  ${stateConfig.color}${ANSI.bold}${stateConfig.symbol} ${stateConfig.label.toUpperCase()}${ANSI.reset}`,
    );
    lines.push('');
    lines.push(`  ${ANSI.dim}run:${ANSI.reset}     ${snapshot.runId}`);
    lines.push(`  ${ANSI.dim}elapsed:${ANSI.reset} ${elapsed}`);
    lines.push('');

    // Final counts
    const totalDone = snapshot.taskCounts.done + snapshot.staticCounts.pass;
    const totalFail = snapshot.taskCounts.failed + snapshot.staticCounts.fail;
    lines.push(
      `  ${ANSI.dim}results:${ANSI.reset}  ${ANSI.green}${totalDone} passed${ANSI.reset} ${ANSI.dim}/${ANSI.reset} ${totalFail > 0 ? ANSI.red : ANSI.dim}${totalFail} failed${ANSI.reset}`,
    );
    lines.push('');

    safeStdoutWrite('\x1b[2J\x1b[H');
    safeStdoutWrite(`${lines.join('\n')}\n`);
  }

  cleanup(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    safeStdoutWrite('\x1b[?25h'); // Show cursor
    safeStdoutWrite('\x1b[?1049l'); // Exit alternate screen
  }
}
