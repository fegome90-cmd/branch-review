// Constants and configuration for reviewctl

export const PROJECT_ROOT = process.cwd();
export const CTX_DIR = `${PROJECT_ROOT}/_ctx`;
export const REVIEW_RUNS_DIR = `${CTX_DIR}/review_runs`;
export const EXPLORE_DIR = `${PROJECT_ROOT}/explore`;
export const DOCS_DIR = `${PROJECT_ROOT}/docs`;
export const PLANS_DIR = `${DOCS_DIR}/plans`;
export const CLAUDE_DIR = `${PROJECT_ROOT}/.claude`;
export const CLAUDE_PLANS_DIR = `${CLAUDE_DIR}/plans`;
export const TEMPLATES_DIR = `${CLAUDE_DIR}/templates`;

// Anti-loop limits
export const MAX_AGENTS = 3;
export const DEFAULT_TIMEOUT_MINS = 8;
export const MAX_OUTPUT_LINES = 120;

// Review levels
export type ReviewLevel = 'auto' | 'quick' | 'thorough' | 'comprehensive';

// Review types
export type ReviewType = 'auto' | 'python' | 'sql' | 'general' | 'python+sql';

// Drift status
export type DriftStatus = 'ALIGNED' | 'DRIFT_RISK' | 'DRIFT_CONFIRMED';

// Plan status
export type PlanStatus = 'FOUND' | 'MISSING' | 'AMBIGUOUS';

// Agent names
export const AGENT_NAMES = [
  'code-reviewer',
  'code-simplifier', 
  'silent-failure-hunter',
  'sql-safety-hunter',
  'pr-test-analyzer'
] as const;

export type AgentName = typeof AGENT_NAMES[number];

// Priority levels
export type Priority = 'P0' | 'P1' | 'P2';

// Verdict
export type Verdict = 'PASS' | 'FAIL';

// Run status
export type RunStatus = 'pending' | 'exploring' | 'planning' | 'running' | 'verdict' | 'completed' | 'failed';

// Interfaces
export interface RunMetadata {
  run_id: string;
  branch: string;
  base_branch: string;
  created_at: string;
  status: RunStatus;
  plan_status: PlanStatus;
  plan_path?: string;
  drift_status?: DriftStatus;
}

export interface Finding {
  id: string;
  priority: Priority;
  title: string;
  location: {
    file: string;
    line_start?: number;
    line_end?: number;
    function?: string;
  };
  description: string;
  evidence: {
    snippet: string;
    snippet_language?: string;
  };
  impact?: string;
  fix_suggestion?: string;
}

export interface AgentResult {
  run_id: string;
  agent: AgentName;
  timestamp: string;
  execution_time_ms: number;
  findings: Finding[];
  statistics: {
    p0_count: number;
    p1_count: number;
    p2_count: number;
  };
  verdict: {
    result: Verdict;
    justification: string;
  };
}

export interface FinalResult {
  run_id: string;
  branch: string;
  base_branch: string;
  timestamp: string;
  verdict: Verdict;
  statistics: {
    p0_total: number;
    p1_total: number;
    p2_total: number;
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  agents: Record<string, { p0: number; p1: number; p2: number; status: string }>;
  statics: Record<string, { issues: number; status: string }>;
  drift: {
    status: DriftStatus;
    plan_source: string | null;
  };
  artifacts: {
    context: string;
    diff: string;
    reports: string[];
    final_json: string;
  };
}

// Precondition errors
export const PRECONDITION_ERRORS = {
  NOT_REVIEW_BRANCH: 'Not on review/* branch. Create or switch to a review branch first.',
  MISSING_CONTEXT: 'explore/context.md not found. Run: reviewctl explore context',
  MISSING_DIFF: 'explore/diff.md not found. Run: reviewctl explore diff',
  MISSING_PLAN: 'Plan is MISSING or AMBIGUOUS. Provide --plan-path or resolve manually.',
  DRIFT_CONFIRMED: 'DRIFT_CONFIRMED blocks review run. Resolve drift issues first.',
  NO_RUN_FOUND: 'No active review run found. Run: reviewctl init',
  ALREADY_RUNNING: 'Review run already in progress.',
  NO_PR: 'No PR found for current branch.',
  NOT_PASS: 'Cannot merge: verdict is not PASS.',
} as const;
