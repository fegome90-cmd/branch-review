import { describe, expect, test } from 'bun:test';
import { formatSummaryLine } from './summary.js';

describe('formatSummaryLine', () => {
  test('formats completed summary', () => {
    const line = formatSummaryLine({
      commandName: 'run',
      runId: 'run_20260226_abc123',
      state: 'COMPLETED',
      durationMs: 42000,
    });

    expect(line).toContain('[reviewctl] run');
    expect(line).toContain('✓ completed');
    expect(line).toContain('run_20260226_abc123');
  });

  test('formats failed summary with artifact path', () => {
    const line = formatSummaryLine({
      commandName: 'run',
      runId: 'run_20260226_abc123',
      state: 'FAILED',
      durationMs: 8000,
      errorArtifactPath: '_ctx/review_runs/run_20260226_abc123/error.json',
    });

    expect(line).toContain('✗ failed');
    expect(line).toContain(
      '→ ver: _ctx/review_runs/run_20260226_abc123/error.json',
    );
  });
});
