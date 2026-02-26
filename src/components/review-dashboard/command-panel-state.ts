import type { RunInfo } from '@/components/review/types';

export interface CommandPanelState {
  hasToken: boolean;
  canRun: boolean;
  requiresRun: boolean;
  disabledReason: string | null;
}

export function getCommandPanelState(
  reviewToken: string,
  runningCommand: string | null,
  currentRun: RunInfo | null,
): CommandPanelState {
  const hasToken = reviewToken.trim().length > 0;
  const canRun = runningCommand === null && hasToken;
  const requiresRun = canRun && Boolean(currentRun);

  const disabledReason = !hasToken
    ? 'Add Review API Token to enable commands.'
    : !currentRun
      ? 'Initialize a run to enable workflow commands.'
      : null;

  return {
    hasToken,
    canRun,
    requiresRun,
    disabledReason,
  };
}
