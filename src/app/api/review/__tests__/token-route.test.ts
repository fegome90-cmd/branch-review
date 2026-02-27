import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DELETE, POST } from '../token/route';

const TOKEN_KEY = 'REVIEW_API_TOKEN';
const previousToken = process.env[TOKEN_KEY];

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/review/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/review/token', () => {
  beforeEach(() => {
    process.env[TOKEN_KEY] = 'secret-token';
  });

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env[TOKEN_KEY];
    } else {
      process.env[TOKEN_KEY] = previousToken;
    }
  });

  it('returns 401 for invalid token', async () => {
    const response = await POST(makeRequest({ token: 'wrong' }) as any);
    expect(response.status).toBe(401);
  });

  it('sets a HttpOnly cookie for valid token', async () => {
    const response = await POST(makeRequest({ token: 'secret-token' }) as any);
    const setCookie = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(setCookie).toContain('review_api_token=secret-token');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=strict');
  });
});

describe('DELETE /api/review/token', () => {
  it('clears review token cookie', async () => {
    const response = await DELETE();
    const setCookie = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(setCookie).toContain('review_api_token=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
