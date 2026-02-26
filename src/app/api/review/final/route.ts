import { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonFail, jsonOk } from '@/lib/http';
import { readFinalByRunId } from '@/lib/review-runs';

const runIdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    const parsedRunId = runIdSchema.safeParse(runId);
    if (!parsedRunId.success) {
      return jsonFail('Invalid or missing runId', 400, { code: 'INVALID_INPUT' });
    }

    const finalData = await readFinalByRunId(parsedRunId.data);
    if (!finalData) {
      return jsonFail('Final data not found', 404, { code: 'NOT_FOUND' });
    }

    return jsonOk({ result: finalData });
  } catch {
    return jsonFail('Failed to read final data', 500, { code: 'INTERNAL_ERROR' });
  }
}
