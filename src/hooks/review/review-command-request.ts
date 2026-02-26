import type { ReviewCommand } from '@/components/review/types';

export function buildCommandRequestInit(
  command: ReviewCommand,
  args: Record<string, string>,
  token: string,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token.trim() ? { 'x-review-token': token.trim() } : {}),
    },
    body: JSON.stringify({ command, args }),
  };
}
