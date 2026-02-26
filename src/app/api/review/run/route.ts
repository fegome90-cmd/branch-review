import { jsonFail, jsonOk } from '@/lib/http';
import { readCurrentRun } from '@/lib/review-runs';

export async function GET() {
  try {
    const runData = await readCurrentRun();
    return jsonOk({ run: runData });
  } catch {
    return jsonFail('Failed to read run data', 500, { code: 'INTERNAL_ERROR' });
  }
}
