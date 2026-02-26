import { useCallback, useEffect, useState } from 'react';
import type { RunInfo } from '@/components/review/types';
import { parseApiEnvelope } from '@/hooks/review/api';
import { normalizeRunData } from '@/hooks/review/review-run-normalize';

export function useReviewRun() {
  const [run, setRun] = useState<RunInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/review/run');
      const data = await parseApiEnvelope<{ run: RunInfo | null }>(response);
      setRun(normalizeRunData(data));
    } catch (requestError) {
      setRun(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to fetch run data',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    run,
    loading,
    error,
    refresh,
  };
}
