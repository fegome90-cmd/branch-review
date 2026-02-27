import { access } from 'node:fs/promises';
import path from 'node:path';

export type HealthCheckResult = {
  ok: boolean;
  reason?: string;
};

export async function checkReviewRunsReadable(): Promise<HealthCheckResult> {
  const configuredPath = process.env.HEALTHCHECK_REVIEW_RUNS_PATH;
  const targetPath =
    configuredPath || path.join(process.cwd(), '_ctx', 'review_runs');

  try {
    await access(targetPath);
    return { ok: true };
  } catch (error: unknown) {
    const reason =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : 'UNREADABLE_PATH';

    return { ok: false, reason };
  }
}
