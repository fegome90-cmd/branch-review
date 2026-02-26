import { useCallback, useState } from 'react';
import type { ReviewCommand } from '@/components/review/types';
import { parseApiEnvelope } from '@/hooks/review/api';
import { buildCommandRequestInit } from '@/hooks/review/review-command-request';

interface ExecuteCommandInput {
  command: ReviewCommand;
  args?: Record<string, string>;
  token: string;
}

export function useReviewCommand() {
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const execute = useCallback(
    async ({ command, args = {}, token }: ExecuteCommandInput) => {
      setRunningCommand(command);

      try {
        const response = await fetch(
          '/api/review/command',
          buildCommandRequestInit(command, args, token),
        );
        const data = await parseApiEnvelope<{ output: string }>(response);
        return data.output || 'Command completed';
      } finally {
        setRunningCommand(null);
      }
    },
    [],
  );

  return {
    runningCommand,
    execute,
  };
}
