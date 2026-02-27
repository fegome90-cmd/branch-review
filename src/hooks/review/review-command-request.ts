import type { ReviewCommand } from '@/components/review/types';

export function buildCommandRequestInit(
  command: ReviewCommand,
  args: Record<string, string>,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, args }),
  };
}
