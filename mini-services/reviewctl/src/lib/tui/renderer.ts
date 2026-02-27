import type { PhaseStatus, RunSnapshot } from './types.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_TERMINAL_WIDTH = 80;
const MIN_DIVIDER_WIDTH = 20;

function phaseBadge(status: PhaseStatus, frame: string): string {
  if (status === 'DONE') {
    return '✓';
  }
  if (status === 'FAILED') {
    return '✗';
  }
  if (status === 'RUNNING') {
    return frame;
  }
  return '·';
}

/**
 * Best-effort stdout write - silently ignores errors if stdout is closed.
 * Used by renderer to avoid crashing when piped process terminates.
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
    safeStdoutWrite('\x1b[?1049h');
    safeStdoutWrite('\x1b[?25l');
  }

  render(snapshot: RunSnapshot): void {
    if (!this.active) {
      return;
    }

    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex += 1;

    const elapsedSeconds = Math.max(
      0,
      Math.round((Date.now() - snapshot.startedAt) / 1000),
    );
    const width = process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
    const divider = '─'.repeat(Math.max(MIN_DIVIDER_WIDTH, width - 2));

    const lines: string[] = [];
    lines.push(`reviewctl ${snapshot.commandName}`);
    lines.push(`run: ${snapshot.runId}`);
    lines.push(`elapsed: ${elapsedSeconds}s`);
    lines.push(divider);
    lines.push('phases:');

    for (const phase of snapshot.phases) {
      lines.push(
        `  ${phaseBadge(phase.status, frame)} ${phase.label}${phase.detail ? ` — ${phase.detail}` : ''}`,
      );
    }

    lines.push(divider);
    lines.push(
      `tasks    pending:${snapshot.taskCounts.pending} done:${snapshot.taskCounts.done} failed:${snapshot.taskCounts.failed}`,
    );
    lines.push(
      `statics  pending:${snapshot.staticCounts.pending} pass:${snapshot.staticCounts.pass} fail:${snapshot.staticCounts.fail} skip:${snapshot.staticCounts.skip}`,
    );
    lines.push('Ctrl+C para abortar y limpiar terminal');

    safeStdoutWrite('\x1b[2J\x1b[H');
    safeStdoutWrite(`${lines.join('\n')}\n`);
  }

  cleanup(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    safeStdoutWrite('\x1b[?25h');
    safeStdoutWrite('\x1b[?1049l');
  }
}
