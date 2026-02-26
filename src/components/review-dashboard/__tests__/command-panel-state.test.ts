import { describe, expect, it } from 'bun:test';
import type { RunInfo } from '@/components/review/types';
import { getCommandPanelState } from '@/components/review-dashboard/command-panel-state';

const run: RunInfo = {
  run_id: 'run-1',
  branch: 'review/feat',
  base_branch: 'main',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
  plan_status: 'FOUND',
};

describe('getCommandPanelState', () => {
  it('requires token first', () => {
    const state = getCommandPanelState('', null, run);

    expect(state.hasToken).toBe(false);
    expect(state.canRun).toBe(false);
    expect(state.requiresRun).toBe(false);
    expect(state.disabledReason).toContain('Review API Token');
  });

  it('requires run when token exists', () => {
    const state = getCommandPanelState('token', null, null);

    expect(state.hasToken).toBe(true);
    expect(state.canRun).toBe(true);
    expect(state.requiresRun).toBe(false);
    expect(state.disabledReason).toContain('Initialize a run');
  });

  it('enables workflow commands when token and run are present', () => {
    const state = getCommandPanelState('token', null, run);

    expect(state.hasToken).toBe(true);
    expect(state.canRun).toBe(true);
    expect(state.requiresRun).toBe(true);
    expect(state.disabledReason).toBeNull();
  });

  it('blocks commands while a command is running', () => {
    const state = getCommandPanelState('token', 'plan', run);

    expect(state.canRun).toBe(false);
    expect(state.requiresRun).toBe(false);
  });
});
