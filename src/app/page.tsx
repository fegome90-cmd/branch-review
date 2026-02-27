'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReviewCommand } from '@/components/review/types';
import { CommandOutputCard } from '@/components/review-dashboard/CommandOutputCard';
import { CommandPanel } from '@/components/review-dashboard/CommandPanel';
import { DashboardHeader } from '@/components/review-dashboard/DashboardHeader';
import { ResultsTabs } from '@/components/review-dashboard/ResultsTabs';
import { RunStatusCard } from '@/components/review-dashboard/RunStatusCard';
import {
  clearReviewTokenCookie,
  syncReviewTokenCookie,
} from '@/hooks/review/review-token-sync';
import { useReviewCommand } from '@/hooks/review/use-review-command';
import { useReviewFinal } from '@/hooks/review/use-review-final';
import { useReviewRun } from '@/hooks/review/use-review-run';

export default function ReviewDashboard() {
  const [reviewToken, setReviewToken] = useState('');
  const [commandOutput, setCommandOutput] = useState('');
  const {
    run: currentRun,
    loading: runLoading,
    error: runError,
    refresh: refreshRun,
  } = useReviewRun();
  const {
    result: finalResult,
    loading: finalLoading,
    error: finalError,
    refresh: refreshFinal,
  } = useReviewFinal(currentRun?.run_id ?? null);
  const { runningCommand, execute } = useReviewCommand();

  useEffect(() => {
    const token = reviewToken.trim();
    const timeoutId = window.setTimeout(() => {
      if (!token) {
        void clearReviewTokenCookie();
        return;
      }

      void syncReviewTokenCookie(token);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [reviewToken]);

  async function handleRefresh() {
    await refreshRun();
    await refreshFinal();
  }

  async function runCommand(
    command: ReviewCommand,
    args: Record<string, string> = {},
  ) {
    setCommandOutput(`Running: reviewctl ${command}...`);

    try {
      const token = reviewToken.trim();
      if (!token) {
        throw new Error('Review API token is required.');
      }

      await syncReviewTokenCookie(token);
      const output = await execute({ command, args });
      setCommandOutput(output);
      await handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCommandOutput(`Error: ${message}`);
    }
  }

  function handleTokenChange(token: string) {
    setReviewToken(token);
  }

  if (runLoading || finalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span suppressHydrationWarning>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader onRefresh={handleRefresh} />

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6">
            <RunStatusCard run={currentRun} />
            {(runError || finalError) && (
              <p className="text-sm text-destructive" role="alert">
                {runError || finalError}
              </p>
            )}
            <CommandPanel
              reviewToken={reviewToken}
              runningCommand={runningCommand}
              currentRun={currentRun}
              onTokenChange={handleTokenChange}
              onRunCommand={runCommand}
            />
            <CommandOutputCard output={commandOutput} />
          </div>

          <div className="space-y-6 lg:col-span-2">
            <ResultsTabs finalResult={finalResult} />
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>reviewctl v1.0 - Code Review Orchestration</span>
            <span>SSOT Templates • Anti-Loop • Plan Resolver</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
