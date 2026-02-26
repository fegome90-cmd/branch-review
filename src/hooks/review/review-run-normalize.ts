import type { RunInfo } from '@/components/review/types';

export function normalizeRunData(data: { run: RunInfo | null }) {
  return data.run ?? null;
}
