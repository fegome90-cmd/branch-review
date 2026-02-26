import { describe, expect, it } from 'bun:test';
import { parseApiEnvelope } from '@/hooks/review/api';

describe('parseApiEnvelope', () => {
  it('returns data for successful envelopes', async () => {
    const response = new Response(
      JSON.stringify({ data: { ok: true }, error: null }),
      { status: 200 },
    );
    const data = await parseApiEnvelope<{ ok: boolean }>(response);

    expect(data.ok).toBe(true);
  });

  it('throws payload error message when provided', async () => {
    const response = new Response(
      JSON.stringify({
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized token' },
      }),
      { status: 401 },
    );

    await expect(parseApiEnvelope(response)).rejects.toThrow(
      'Unauthorized token',
    );
  });

  it('maps common status codes when envelope has no message', async () => {
    const unauthorized = new Response(
      JSON.stringify({ data: null, error: null }),
      { status: 401 },
    );
    const tooLarge = new Response(JSON.stringify({ data: null, error: null }), {
      status: 413,
    });
    const limited = new Response(JSON.stringify({ data: null, error: null }), {
      status: 429,
    });
    const unavailable = new Response(
      JSON.stringify({ data: null, error: null }),
      { status: 503 },
    );
    const genericServer = new Response(
      JSON.stringify({ data: null, error: null }),
      { status: 500 },
    );
    const genericClient = new Response(
      JSON.stringify({ data: null, error: null }),
      { status: 400 },
    );

    await expect(parseApiEnvelope(unauthorized)).rejects.toThrow(
      'Unauthorized: review token is missing or invalid.',
    );
    await expect(parseApiEnvelope(tooLarge)).rejects.toThrow(
      'Payload too large.',
    );
    await expect(parseApiEnvelope(limited)).rejects.toThrow(
      'Too many requests. Try again in a moment.',
    );
    await expect(parseApiEnvelope(unavailable)).rejects.toThrow(
      'Service unavailable. Check server configuration.',
    );
    await expect(parseApiEnvelope(genericServer)).rejects.toThrow(
      'Server error. Please retry.',
    );
    await expect(parseApiEnvelope(genericClient)).rejects.toThrow(
      'Request failed',
    );
  });
});
