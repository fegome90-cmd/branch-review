import type { SummaryLineInput } from './types.js';

function formatSeconds(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

export function formatSummaryLine(input: SummaryLineInput): string {
  const duration = `(${formatSeconds(input.durationMs)})`;

  if (input.state === 'COMPLETED') {
    return `[reviewctl] ${input.commandName}   ✓ completed   ${duration}   ${input.runId}`;
  }

  if (input.state === 'ABORTED') {
    return `[reviewctl] ${input.commandName}   ! aborted     ${duration}   ${input.runId}`;
  }

  if (input.state === 'NO_TTY_FALLBACK') {
    return `[reviewctl] ${input.commandName}   plain mode    ${duration}   ${input.runId}`;
  }

  const suffix = input.errorArtifactPath
    ? `   → ver: ${input.errorArtifactPath}`
    : '';
  return `[reviewctl] ${input.commandName}   ✗ failed      ${duration}   ${input.runId}${suffix}`;
}
