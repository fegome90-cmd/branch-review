import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GET as getFinal } from '../final/route';
import { GET as getRun } from '../run/route';
import { GET as getState } from '../state/route';

const runsRoot = path.join(process.cwd(), '_ctx', 'review_runs');
const currentPath = path.join(runsRoot, 'current.json');
const backupPath = `${currentPath}.bak-test`;

function ensureRunsRoot() {
  fs.mkdirSync(runsRoot, { recursive: true });
}

beforeEach(() => {
  ensureRunsRoot();
  if (fs.existsSync(currentPath)) {
    fs.copyFileSync(currentPath, backupPath);
  }
});

afterEach(() => {
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
  it('returns 400 envelope when runId is missing', async () => {
    const request = new Request('http://localhost/api/review/final');
    const response = await getFinal(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('INVALID_INPUT');
  });

  it('returns 404 envelope when final.json is missing', async () => {
    const request = new Request('http://localhost/api/review/final?runId=test-run');
    const response = await getFinal(request as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with final payload when file exists', async () => {
    const runDir = path.join(runsRoot, 'test-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'final.json'), JSON.stringify({ verdict: 'ok' }), 'utf-8');

    const request = new Request('http://localhost/api/review/final?runId=test-run');
    const response = await getFinal(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data.result.verdict).toBe('ok');
  });
});

describe('GET /api/review/run and /api/review/state', () => {
  it('returns 500 when current.json is malformed', async () => {
    fs.writeFileSync(currentPath, '{ bad-json', 'utf-8');

    const runResponse = await getRun();
    const stateResponse = await getState();
    const runPayload = await runResponse.json();
    const statePayload = await stateResponse.json();

    expect(runResponse.status).toBe(500);
    expect(runPayload.error.code).toBe('INTERNAL_ERROR');
    expect(stateResponse.status).toBe(500);
    expect(statePayload.error.code).toBe('INTERNAL_ERROR');
  });
});
