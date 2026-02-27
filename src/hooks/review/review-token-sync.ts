import { parseApiEnvelope } from '@/hooks/review/api';

export async function syncReviewTokenCookie(token: string) {
  const response = await fetch('/api/review/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  await parseApiEnvelope<{ authenticated: boolean }>(response);
}

export async function clearReviewTokenCookie() {
  const response = await fetch('/api/review/token', {
    method: 'DELETE',
  });

  await parseApiEnvelope<{ cleared: boolean }>(response);
}
