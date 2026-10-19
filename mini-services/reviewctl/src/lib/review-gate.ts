/** Pure local review gate; a PASS is not a GitHub merge authorization. */
export type ReviewGateState = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'STALE' | 'ERROR';
export type AgentVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface ReviewGateInput {
  expectedHead: string | undefined;
  currentHead: string;
  driftStatus?: string;
  driftOverrideUsed: boolean;
  requiredAgents: readonly string[];
  missingAgents: readonly string[];
  invalidAgents: readonly string[];
  agentVerdicts: Readonly<Record<string, AgentVerdict>>;
  p0Count: number;
  staticBlockers: number;
}

export function evaluateReviewGate(input: ReviewGateInput): ReviewGateState {
  if (
    !input.expectedHead ||
    input.expectedHead === 'unknown' ||
    !input.currentHead ||
    input.currentHead === 'unknown' ||
    input.expectedHead !== input.currentHead ||
    input.driftOverrideUsed ||
    ['DRIFT_RISK', 'DRIFT_CONFIRMED', 'DRIFT_OVERRIDE'].includes(
      input.driftStatus ?? '',
    )
  ) {
    return 'STALE';
  }

  if (
    !Number.isSafeInteger(input.p0Count) ||
    input.p0Count < 0 ||
    !Number.isSafeInteger(input.staticBlockers) ||
    input.staticBlockers < 0
  ) {
    return 'ERROR';
  }

  if (
    input.requiredAgents.length === 0 ||
    input.missingAgents.length > 0 ||
    input.invalidAgents.length > 0 ||
    input.requiredAgents.some((name) => !(name in input.agentVerdicts)) ||
    Object.values(input.agentVerdicts).some(
      (result) => result !== 'PASS' && result !== 'FAIL',
    )
  ) {
    return 'INCOMPLETE';
  }

  if (
    Object.values(input.agentVerdicts).includes('FAIL') ||
    input.p0Count > 0 ||
    input.staticBlockers > 0
  ) {
    return 'FAIL';
  }

  return 'PASS';
}
