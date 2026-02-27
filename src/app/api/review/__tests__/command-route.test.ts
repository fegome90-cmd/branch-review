import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { POST } from '../command/route';

const TOKEN_KEY = 'REVIEW_API_TOKEN';
const PREVIOUS_TOKEN_KEY = 'REVIEW_API_TOKEN_PREVIOUS';
const previousToken = process.env[TOKEN_KEY];
const previousPreviousToken = process.env[PREVIOUS_TOKEN_KEY];

function makeRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) headers['x-review-token'] = token;

  return new Request('http://localhost/api/review/command', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/review/command', () => {
  beforeEach(() => {
    delete process.env[TOKEN_KEY];
    delete process.env[PREVIOUS_TOKEN_KEY];
  });

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env[TOKEN_KEY];
    } else {
      process.env[TOKEN_KEY] = previousToken;
    }

    if (previousPreviousToken === undefined) {
      delete process.env[PREVIOUS_TOKEN_KEY];
    } else {
      process.env[PREVIOUS_TOKEN_KEY] = previousPreviousToken;
    }
  });

  it('returns 503 when REVIEW_API_TOKEN is not configured', async () => {
    const response = await POST(makeRequest({ command: 'plan' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('MISCONFIGURED');
  });

  it('returns 401 when token is invalid', async () => {
    process.env[TOKEN_KEY] = 'secret-token';

    const response = await POST(
      makeRequest({ command: 'plan' }, 'wrong-token') as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts previous token during rotation', async () => {
    process.env[TOKEN_KEY] = 'new-secret-token';
    process.env[PREVIOUS_TOKEN_KEY] = 'old-secret-token';

    const response = await POST(
      makeRequest({ command: 'not-allowed' }, 'old-secret-token') as any,
    );
    expect(response.status).toBe(400);
  });

  it('returns 413 for oversized payloads', async () => {
    process.env[TOKEN_KEY] = 'secret-token';
    const huge = 'x'.repeat(17000);
    const request = new Request('http://localhost/api/review/command', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-review-token': 'secret-token',
      },
      body: JSON.stringify({ command: 'plan', args: { huge } }),
    });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for invalid payload', async () => {
    process.env[TOKEN_KEY] = 'secret-token';

    const response = await POST(
      makeRequest(
        { command: 'not-allowed', args: { runId: 'x' } },
        'secret-token',
      ) as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('INVALID_INPUT');
  });
});
