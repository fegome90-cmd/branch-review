import { useCallback, useEffect, useState } from 'react';
import type { FinalResult } from '@/components/review/types';
import { parseApiEnvelope } from '@/hooks/review/api';
import { buildReviewFinalUrl } from '@/hooks/review/review-final-url';

export function useReviewFinal(runId: string | null) {
  const [result, setResult] = useState<FinalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runId) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildReviewFinalUrl(runId));
      const data = await parseApiEnvelope<{ result: FinalResult }>(response);
      setResult(data.result ?? null);
    } catch (requestError) {
      setResult(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to fetch final result',
      );
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    result,
    loading,
    error,
    refresh,
  };
}
