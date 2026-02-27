import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { GET as getFinal } from '../final/route';
import { GET as getRun } from '../run/route';
import { GET as getState } from '../state/route';

const runsRoot = path.join(process.cwd(), '_ctx', 'review_runs');
const currentPath = path.join(runsRoot, 'current.json');
const backupPath = `${currentPath}.bak-test`;

// Test authentication token
const TEST_TOKEN = 'test-review-token-for-security-tests';

// P0-3: Store original env for proper cleanup
const originalToken = process.env.REVIEW_API_TOKEN;
const originalPrevToken = process.env.REVIEW_API_TOKEN_PREVIOUS;

function ensureRunsRoot() {
  fs.mkdirSync(runsRoot, { recursive: true });
}

function createAuthRequest(url: string): Request {
  return new Request(url, {
    headers: { 'x-review-token': TEST_TOKEN },
  }) as any;
}

beforeEach(() => {
  ensureRunsRoot();
  if (fs.existsSync(currentPath)) {
    fs.copyFileSync(currentPath, backupPath);
  }
  // Set test token in environment for auth validation
  process.env.REVIEW_API_TOKEN = TEST_TOKEN;
});

afterEach(() => {
  // P0-3: Restore original environment to prevent test pollution
  if (originalToken === undefined) {
    delete process.env.REVIEW_API_TOKEN;
  } else {
    process.env.REVIEW_API_TOKEN = originalToken;
  }

  if (originalPrevToken === undefined) {
    delete process.env.REVIEW_API_TOKEN_PREVIOUS;
  } else {
    process.env.REVIEW_API_TOKEN_PREVIOUS = originalPrevToken;
  }

  if (fs.existsSync(currentPath)) {
    fs.unlinkSync(currentPath);
  }

  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, currentPath);
    fs.unlinkSync(backupPath);
  }

  const testRunDir = path.join(runsRoot, 'test-run');
  if (fs.existsSync(testRunDir)) {
    fs.rmSync(testRunDir, { recursive: true, force: true });
  }
});

describe('GET /api/review/final', () => {
  it('returns 401 when auth token is missing', async () => {
    const request = new Request('http://localhost/api/review/final?runId=test');
    const response = await getFinal(request as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 envelope when runId is missing', async () => {
    const request = createAuthRequest('http://localhost/api/review/final');
    const response = await getFinal(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('INVALID_INPUT');
  });

  it('returns 404 envelope when final.json is missing', async () => {
    const request = createAuthRequest(
      'http://localhost/api/review/final?runId=test-run',
    );
    const response = await getFinal(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with final payload when file exists', async () => {
    const runDir = path.join(runsRoot, 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'final.json'),
      JSON.stringify({ verdict: 'ok' }),
      'utf-8',
    );

    const request = createAuthRequest(
      'http://localhost/api/review/final?runId=test-run',
    );
    const response = await getFinal(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data.result.verdict).toBe('ok');
  });

  it('blocks path traversal attempts', async () => {
    // Attempt to traverse outside review_runs directory
    const request = createAuthRequest(
      'http://localhost/api/review/final?runId=..',
    );
    const response = await getFinal(request);
    const payload = await response.json();

    // Should fail validation (regex blocks dots) or return 404
    expect([400, 404]).toContain(response.status);
  });

  // P1-2: Expanded path traversal test cases
  it('blocks various path traversal attack vectors', async () => {
    const maliciousRunIds = [
      '..', // Simple parent
      '../..', // Multiple parents
      '../../../etc', // Deep traversal
      '/etc/passwd', // Absolute path
      '..\\..', // Windows-style (if applicable)
    ];

    for (const runId of maliciousRunIds) {
      const request = createAuthRequest(
        `http://localhost/api/review/final?runId=${encodeURIComponent(runId)}`,
      );
      const response = await getFinal(request);

      // All should fail validation (regex) or return 404
      expect([400, 404]).toContain(response.status);
    }
  });
});

describe('GET /api/review/run and /api/review/state', () => {
  it('returns 401 when auth token is missing', async () => {
    const request = new Request('http://localhost/api/review/run') as any;
    const response = await getRun(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 500 when current.json is malformed', async () => {
    fs.writeFileSync(currentPath, '{ bad-json', 'utf-8');

    const runResponse = await getRun(
      createAuthRequest('http://localhost/api/review/run'),
    );
    const stateResponse = await getState(
      createAuthRequest('http://localhost/api/review/state'),
    );
    const runPayload = await runResponse.json();
    const statePayload = await stateResponse.json();

    expect(runResponse.status).toBe(500);
    expect(runPayload.error.code).toBe('INTERNAL_ERROR');
    expect(stateResponse.status).toBe(500);
    expect(statePayload.error.code).toBe('INTERNAL_ERROR');
  });
});
