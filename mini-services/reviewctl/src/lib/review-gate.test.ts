import { describe, expect, it } from 'bun:test';
import {
  evaluateReviewGate,
  type ReviewGateInput,
  type ReviewGateState,
} from './review-gate.js';

const base: ReviewGateInput = {
  expectedHead: 'a1b2c3d',
  currentHead: 'a1b2c3d',
  driftStatus: 'ALIGNED',
  driftOverrideUsed: false,
  requiredAgents: ['code-reviewer'],
  missingAgents: [],
  invalidAgents: [],
  agentVerdicts: { 'code-reviewer': 'PASS' },
  p0Count: 0,
  staticBlockers: 0,
};

const cases: Array<{
  name: string;
  expected: ReviewGateState;
  overrides: Partial<ReviewGateInput>;
}> = [
  { name: 'complete clean review passes', expected: 'PASS', overrides: {} },
  {
    name: 'required agent FAIL with zero P0 blocks',
    expected: 'FAIL',
    overrides: { agentVerdicts: { 'code-reviewer': 'FAIL' } },
  },
  {
    name: 'a P0 blocks even with agent PASS',
    expected: 'FAIL',
    overrides: { p0Count: 1 },
  },
  {
    name: 'required static failure blocks',
    expected: 'FAIL',
    overrides: { staticBlockers: 1 },
  },
  {
    name: 'required report missing never passes',
    expected: 'INCOMPLETE',
    overrides: { missingAgents: ['code-reviewer'] },
  },
  {
    name: 'invalid report never passes',
    expected: 'INCOMPLETE',
    overrides: { invalidAgents: ['code-reviewer'] },
  },
  {
    name: 'unknown agent verdict never passes',
    expected: 'INCOMPLETE',
    overrides: { agentVerdicts: { 'code-reviewer': 'UNKNOWN' } },
  },
  {
    name: 'a missing result for a required agent never passes',
    expected: 'INCOMPLETE',
    overrides: { agentVerdicts: {} },
  },
  {
    name: 'zero required agents never gives an empty PASS',
    expected: 'INCOMPLETE',
    overrides: { requiredAgents: [] },
  },
  {
    name: 'changed HEAD invalidates a previous review',
    expected: 'STALE',
    overrides: { currentHead: 'abcdeff' },
  },
  {
    name: 'missing plan HEAD blocks',
    expected: 'STALE',
    overrides: { expectedHead: undefined },
  },
  {
    name: 'drift override is not a clean review',
    expected: 'STALE',
    overrides: { driftOverrideUsed: true },
  },
  {
    name: 'risk status blocks',
    expected: 'STALE',
    overrides: { driftStatus: 'DRIFT_RISK' },
  },
  {
    name: 'invalid numeric counts fail closed',
    expected: 'ERROR',
    overrides: { p0Count: Number.NaN },
  },
];

describe('review gate fail-closed policy', () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      expect(evaluateReviewGate({ ...base, ...scenario.overrides })).toBe(
        scenario.expected,
      );
    });
  }
});
