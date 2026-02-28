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

/**
 * Review depth levels.
 *
 * - `auto`: Automatically determine based on diff size
 * - `quick`: Fast review, focus on critical issues
 * - `thorough`: Comprehensive review with detailed analysis
 * - `comprehensive`: Maximum depth, includes edge cases
 */
export type ReviewLevel = 'auto' | 'quick' | 'thorough' | 'comprehensive';

/**
 * Review type based on stack.
 *
 * - `auto`: Auto-detect from project files
 * - `python`: Python-focused review
 * - `sql`: SQL-focused review
 * - `general`: Language-agnostic review
 * - `python+sql`: Combined Python + SQL review
 */
export type ReviewType = 'auto' | 'python' | 'sql' | 'general' | 'python+sql';

/**
 * Drift status of review run state.
 *
 * - `ALIGNED`: No drift detected
 * - `DRIFT_RISK`: Potential drift (HEAD changed but digests OK)
 * - `DRIFT_CONFIRMED`: Drift confirmed (digests changed)
 * - `DRIFT_OVERRIDE`: User approved override with `--allow-drift`
 */
export type DriftStatus =
  | 'ALIGNED'
  | 'DRIFT_RISK'
  | 'DRIFT_CONFIRMED'
  | 'DRIFT_OVERRIDE';

/**
 * Plan resolution status.
 *
 * - `FOUND`: Single plan matched
 * - `MISSING`: No matching plan found
 * - `AMBIGUOUS`: Multiple candidates found
 */
export type PlanStatus = 'FOUND' | 'MISSING' | 'AMBIGUOUS';

// Agent names
export const AGENT_NAMES = [
  'code-reviewer',
  'code-simplifier',
  'silent-failure-hunter',
  'sql-safety-hunter',
  'pr-test-analyzer',
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Finding priority levels.
 *
 * - `P0`: Blocking issue, must be fixed before merge
 * - `P1`: Important issue, should be fixed before merge
 * - `P2`: Minor issue, can be deferred
 */
export type Priority = 'P0' | 'P1' | 'P2';

/**
 * Review verdict.
 *
 * - `PASS`: No blocking issues found
 * - `FAIL`: Blocking issues found, requires fixes
 */
export type Verdict = 'PASS' | 'FAIL';

/**
 * Run lifecycle status.
 *
 * - `pending`: Run initialized, waiting for workflow to start
 * - `exploring`: Context and diff being generated
 * - `planning`: Plan being generated
 * - `running`: Agents are executing
 * - `pending_ingest`: Agents completed, waiting for ingestion
 * - `verdict`: Generating final verdict
 * - `completed`: All reports ingested, ready for verdict
 * - `failed`: Run failed due to error
 */
// Run status
export type RunStatus =
  | 'pending'
  | 'exploring'
  | 'planning'
  | 'running'
  | 'pending_ingest'
  | 'verdict'
  | 'completed'
  | 'failed';

// Interfaces
export interface RunMetadata {
  run_id: string;
  branch: string;
  base_branch: string;
  target_branch?: string;
  base_sha?: string;
  target_sha?: string;
  created_at: string;
  status: RunStatus;
  plan_status: PlanStatus;
  plan_path?: string;
  drift_status?: DriftStatus;
  head_sha_at_explore?: string;
  head_sha_at_plan?: string;
  context_digest?: string;
  diff_digest?: string;
  plan_digest?: string;
  drift_override_used?: boolean;
  warnings_total?: number;
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
  target_branch?: string;
  base_branch: string;
  timestamp: string;
  verdict: Verdict;
  statistics: {
    p0_total: number;
    p1_total: number;
    p2_total: number;
    warnings_total: number;
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  agents: Record<
    string,
    { p0: number; p1: number; p2: number; status: string }
  >;
  statics: Record<string, { issues: number; status: string }>;
  warnings_by_agent?: Record<string, number>;
  static_gate: {
    required: Array<{ status: string }>;
    blocking: Array<{ status: string }>;
    passed: number;
    total: number;
  };
  drift: {
    status: DriftStatus;
    plan_source: string | null;
    override_used?: boolean;
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
  NOT_REVIEW_BRANCH:
    'Not on review/* branch. Create or switch to a review branch first.',
  MISSING_CONTEXT:
    'explore/context.md not found. Run: reviewctl explore context',
  MISSING_DIFF: 'explore/diff.md not found. Run: reviewctl explore diff',
  MISSING_PLAN:
    'Plan is MISSING or AMBIGUOUS. Provide --plan-path or resolve manually.',
  DRIFT_CONFIRMED:
    'DRIFT_CONFIRMED blocks review run. Resolve drift issues first.',
  NO_RUN_FOUND: 'No active review run found. Run: reviewctl init',
  ALREADY_RUNNING: 'Review run already in progress.',
  NO_PR: 'No PR found for current branch.',
  NOT_PASS: 'Cannot merge: verdict is not PASS.',
} as const;
