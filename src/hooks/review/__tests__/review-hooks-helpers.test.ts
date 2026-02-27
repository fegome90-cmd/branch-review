import { describe, expect, it } from 'bun:test';
import type { RunInfo } from '@/components/review/types';
import { buildCommandRequestInit } from '@/hooks/review/review-command-request';
import { buildReviewFinalUrl } from '@/hooks/review/review-final-url';
import { normalizeRunData } from '@/hooks/review/review-run-normalize';

describe('review hooks helper functions', () => {
  it('builds command request headers', () => {
    const request = buildCommandRequestInit('plan', {});
    const headers = request.headers as Record<string, string>;

    expect(request.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-review-token']).toBeUndefined();
  });

  it('encodes runId in final URL', () => {
    expect(buildReviewFinalUrl('run/a b')).toBe(
      '/api/review/final?runId=run%2Fa%20b',
    );
  });

  it('normalizes run data and handles null run', () => {
    const run: RunInfo = {
      run_id: 'r1',
      branch: 'review/test',
      base_branch: 'main',
      created_at: '2026-01-01',
      status: 'running',
      plan_status: 'FOUND',
    };

    expect(normalizeRunData({ run })).toEqual(run);
    expect(normalizeRunData({ run: null })).toBeNull();
  });
});
