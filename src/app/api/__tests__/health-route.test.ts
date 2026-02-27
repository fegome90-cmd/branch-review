import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GET as getHealth } from '../route';

const overrideKey = 'HEALTHCHECK_REVIEW_RUNS_PATH';
const previousOverride = process.env[overrideKey];
let tempPath = '';

beforeEach(() => {
  tempPath = fs.mkdtempSync(path.join(os.tmpdir(), 'healthcheck-'));
});

afterEach(() => {
  if (fs.existsSync(tempPath)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }

  if (previousOverride === undefined) {
    delete process.env[overrideKey];
    return;
  }

  process.env[overrideKey] = previousOverride;
});

describe('GET /api healthcheck', () => {
  it('returns 200 with data envelope when ready', async () => {
    process.env[overrideKey] = tempPath;

    const response = await getHealth();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data.status).toBe('ok');
    expect(payload.data.service).toBe('branch-review');
    expect(payload.data.checks.reviewRunsReadable.ok).toBe(true);
  });

  it('returns 503 with error envelope when degraded', async () => {
    process.env[overrideKey] = path.join(tempPath, 'missing-dir');

    const response = await getHealth();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('SERVICE_DEGRADED');
    expect(payload.error.details.status).toBe('degraded');
  });
});
