import { jsonFail, jsonOk } from '@/lib/http';
import { readCurrentRun, readFinalByRunId } from '@/lib/review-runs';

type RunPayload = { run_id?: string };

export async function GET() {
  try {
    const runData = await readCurrentRun<RunPayload>();
    if (!runData) {
      return jsonOk({ run: null, final: null });
    }

    const runId = runData.run_id;
    const finalData = runId ? await readFinalByRunId(runId) : null;

    return jsonOk({ run: runData, final: finalData });
  } catch {
    return jsonFail('Failed to read review state', 500, { code: 'INTERNAL_ERROR' });
  }
}
