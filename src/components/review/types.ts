export interface RunInfo {
  run_id: string;
  branch: string;
  base_branch: string;
  created_at: string;
  status: string;
  plan_status: string;
  plan_path?: string;
  drift_status?: string;
}

export interface FinalResult {
  run_id: string;
  branch: string;
  base_branch: string;
  timestamp: string;
  verdict: 'PASS' | 'FAIL';
  statistics: {
    p0_total: number;
    p1_total: number;
    p2_total: number;
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  agents: Record<
    string,
    { p0: number; p1: number; p2: number; status: string }
  >;
  statics: Record<string, { issues: number; status: string }>;
  drift: {
    status: string;
    plan_source: string | null;
  };
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ApiErrorPayload | null;
}

export type ReviewCommand =
  | 'init'
  | 'explore'
  | 'plan'
  | 'run'
  | 'verdict'
  | 'merge'
  | 'cleanup';
