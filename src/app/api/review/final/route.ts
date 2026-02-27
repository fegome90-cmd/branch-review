import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonFail, jsonOk } from '@/lib/http';
import { isReviewTokenAuthorized } from '@/lib/review-auth';
import { readFinalByRunId } from '@/lib/review-runs';
import { getReviewTokenFromRequest } from '@/lib/review-token';

// Security: Disallow '..' to prevent path traversal attacks
const runIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine((val) => !val.includes('..'), 'Path traversal not allowed');

export async function GET(request: NextRequest) {
  // Security: Require authentication for all review data access
  const providedToken = getReviewTokenFromRequest(request);
  if (!isReviewTokenAuthorized(providedToken)) {
    return jsonFail('Unauthorized', 401, { code: 'UNAUTHORIZED' });
  }

  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    const parsedRunId = runIdSchema.safeParse(runId);
    if (!parsedRunId.success) {
      return jsonFail('Invalid or missing runId', 400, {
        code: 'INVALID_INPUT',
      });
    }

    const finalData = await readFinalByRunId(parsedRunId.data);
    if (!finalData) {
      return jsonFail('Final data not found', 404, { code: 'NOT_FOUND' });
    }

    return jsonOk({ result: finalData });
  } catch {
    return jsonFail('Failed to read final data', 500, {
      code: 'INTERNAL_ERROR',
    });
  }
}
