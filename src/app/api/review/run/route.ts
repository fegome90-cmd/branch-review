import type { NextRequest } from 'next/server';
import { jsonFail, jsonOk } from '@/lib/http';
import { logger } from '@/lib/logger';
import { isReviewTokenAuthorized } from '@/lib/review-auth';
import { readCurrentRun } from '@/lib/review-runs';
import { getReviewTokenFromRequest } from '@/lib/review-token';

export async function GET(request: NextRequest) {
  // Security: Require authentication for all review data access
  const providedToken = getReviewTokenFromRequest(request);
  if (!isReviewTokenAuthorized(providedToken)) {
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }

  try {
    const runData = await readCurrentRun();
    return jsonOk({ run: runData });
  } catch (error) {
    // P0-1: Structured error logging for debugging
    logger.error('Failed to read run data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonFail('Failed to read run data', 500, { code: 'INTERNAL_ERROR' });
  }
}
