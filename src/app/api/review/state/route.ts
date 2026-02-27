import type { NextRequest } from 'next/server';
import { jsonFail, jsonOk } from '@/lib/http';
import { isReviewTokenAuthorized } from '@/lib/review-auth';
import { readCurrentRun, readFinalByRunId } from '@/lib/review-runs';
import { getReviewTokenFromRequest } from '@/lib/review-token';

type RunPayload = { run_id?: string };

export async function GET(request: NextRequest) {
  // Security: Require authentication for all review data access
  const providedToken = getReviewTokenFromRequest(request);
  if (!isReviewTokenAuthorized(providedToken)) {
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }

  try {
    const runData = await readCurrentRun<RunPayload>();
    if (!runData) {
      return jsonOk({ run: null, final: null });
    }

    const runId = runData.run_id;
    const finalData = runId ? await readFinalByRunId(runId) : null;

    return jsonOk({ run: runData, final: finalData });
  } catch {
    return jsonFail('Failed to read review state', 500, {
      code: 'INTERNAL_ERROR',
    });
  }
}
