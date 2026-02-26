import { checkReviewRunsReadable } from '@/lib/healthcheck';
import { jsonFail, jsonOk } from '@/lib/http';

export async function GET() {
  const reviewRunsCheck = await checkReviewRunsReadable();
  const runtimeCheck = { ok: true };

  const isReady = runtimeCheck.ok && reviewRunsCheck.ok;
  const status = isReady ? 'ok' : 'degraded';

  const payload = {
    status,
    service: 'branch-review',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    version: process.env.npm_package_version || 'unknown',
    checks: {
      runtime: runtimeCheck,
      reviewRunsReadable: reviewRunsCheck,
    },
  };

  if (!isReady) {
    return jsonFail('Service degraded', 503, {
      code: 'SERVICE_DEGRADED',
      details: payload,
    });
  }

  return jsonOk(payload);
}
