import { NextResponse } from 'next/server';

/**
 * GET /api/review/info
 *
 * Public discovery endpoint for agents.
 * Returns API metadata without requiring authentication.
 */
export async function GET() {
  const info = {
    name: 'branch-review',
    version: '1.0.0',
    description: 'Multi-agent code review orchestration API',
    baseUrl: '/api/review',
    authentication: {
      required: true,
      methods: ['X-Review-Token header', 'review_api_token cookie'],
    },
    endpoints: [
      {
        method: 'GET',
        path: '/api/review/info',
        description: 'Get API metadata (this endpoint)',
        authRequired: false,
      },
      {
        method: 'GET',
        path: '/api/review/run',
        description: 'Get current run status',
        authRequired: true,
      },
      {
        method: 'GET',
        path: '/api/review/final',
        description: 'Get final verdict for a run',
        queryParams: ['runId'],
        authRequired: true,
      },
      {
        method: 'GET',
        path: '/api/review/state',
        description: 'Get run state snapshot',
        authRequired: true,
      },
      {
        method: 'POST',
        path: '/api/review/command',
        description: 'Execute reviewctl command',
        bodyRequired: true,
        authRequired: true,
        allowedCommands: [
          'init',
          'explore',
          'plan',
          'run',
          'ingest',
          'verdict',
          'pr',
          'merge',
          'cleanup',
        ],
      },
      {
        method: 'POST',
        path: '/api/review/token',
        description: 'Set auth token cookie',
        authRequired: false,
      },
      {
        method: 'DELETE',
        path: '/api/review/token',
        description: 'Clear auth token cookie',
        authRequired: false,
      },
    ],
    rateLimits: {
      unauthenticatedDefault: {
        requests: 30,
        windowMs: 60000,
        scope: 'per-ip + path',
      },
      infoEndpoint: {
        path: '/api/review/info',
        requests: 100,
        windowMs: 60000,
        scope: 'per-ip + path',
      },
      commandExecution: {
        requests: 10,
        windowMs: 60000,
        scope: 'per-clientId (token if present, otherwise ip)',
      },
    },
    errorCodes: [
      { code: 'UNAUTHORIZED', httpStatus: 401 },
      { code: 'INVALID_INPUT', httpStatus: 400 },
      { code: 'NOT_FOUND', httpStatus: 404 },
      { code: 'RATE_LIMITED', httpStatus: 429 },
      { code: 'COMMAND_IN_PROGRESS', httpStatus: 409 },
      { code: 'COMMAND_TIMEOUT', httpStatus: 503 },
      { code: 'COMMAND_FAILED', httpStatus: 500 },
      // PR-specific error codes
      { code: 'GH_NOT_AUTHENTICATED', httpStatus: 503 },
      { code: 'GH_CLI_ERROR', httpStatus: 500 },
      { code: 'PR_EXISTS', httpStatus: 200 },
      { code: 'NO_COMMITS', httpStatus: 400 },
      { code: 'WORKING_TREE_DIRTY', httpStatus: 400 },
      { code: 'INVALID_BRANCH_NAME', httpStatus: 400 },
      // Multi-repo error codes
      { code: 'REPO_NOT_ALLOWED', httpStatus: 403 },
      { code: 'REPO_NOT_FOUND', httpStatus: 404 },
      { code: 'MISCONFIGURED', httpStatus: 503 },
      { code: 'INTERNAL_ERROR', httpStatus: 500 },
    ],
    multiRepo: {
      enabled: true,
      defaultRepo: 'server cwd (branch-review)',
      header: 'X-Repo-Path',
      bodyField: 'repoPath',
      priority: 'body > header > default',
      security: 'ALLOWED_REPOS env var whitelist (colon-separated paths)',
      symlinkResolution: true,
      existenceCheck: true,
      example: {
        header: 'X-Repo-Path: /path/to/your/repo',
        body: '{"command": "init", "repoPath": "/path/to/your/repo"}',
      },
    },
    workflow: [
      'POST /api/review/command {"command": "init"}',
      'POST /api/review/command {"command": "explore", "args": {"mode": "context"}}',
      'POST /api/review/command {"command": "explore", "args": {"mode": "diff"}}',
      'POST /api/review/command {"command": "plan"}',
      'POST /api/review/command {"command": "run"}',
      'POST /api/review/command {"command": "ingest", "args": {"agent": "<name>"}}',
      'POST /api/review/command {"command": "verdict"}',
      'POST /api/review/command {"command": "pr", "args": {"title": "<title>", "body": "<body>"}}',
      'POST /api/review/command {"command": "merge"}',
    ],
    documentation: '/docs/agent-task-card.md',
    multiRepoUsage: {
      cliPath: {
        inBranchReview: 'bun mini-services/reviewctl/src/index.ts <command>',
        inOtherRepos:
          'REVIEW_CLI="/absolute/path/to/branch-review/mini-services/reviewctl/src/index.ts"\nbun $REVIEW_CLI <command>',
      },
      criticalRules: [
        'ALWAYS use absolute path when running from non-branch-review repos',
        'NEVER use relative paths like "mini-services/reviewctl/src/index.ts" in other repos',
        'NEVER use .next/standalone/... (standalone build does not include reviewctl)',
      ],
      planResolution: {
        found:
          'Explicit plan found for current branch/context - uses plan configuration',
        autogenerated:
          'No matching plan (AMBIGUOUS/MISSING) - generates plan-less review from stack detection',
        missing:
          'No plans directory or no candidates - generates plan-less from stack',
        ambiguous:
          'Multiple plans with same score - generates plan-less from stack',
      },
      planModes: [
        {
          situation: 'Standard review with explicit plan',
          command: 'reviewctl init, then reviewctl plan',
          notes: 'Uses resolved plan from docs/plans/',
        },
        {
          situation: 'No plan exists (AMBIGUOUS/MISSING)',
          command: 'reviewctl init, reviewctl plan, reviewctl run',
          notes: 'plan.md is AUTOGENERATED, run works normally',
        },
        {
          situation: 'Force plan-less review',
          command: 'reviewctl plan, then reviewctl run --no-plan',
          notes: 'Skips plan validation entirely',
        },
        {
          situation: 'Override drift protection (debug)',
          command: 'reviewctl run --allow-drift',
          notes: 'Only for debugging, not production use',
        },
      ],
      verdictDisplay: {
        found: 'Verified against plan',
        autogenerated: 'Auto-generated from stack detection',
        missing: 'No plan available',
      },
      troubleshooting: [
        {
          error: 'Module not found',
          cause: 'Using relative path in wrong repo',
          solution:
            'Use absolute path: /Users/felipe_gonzalez/Developer/branch-review/mini-services/reviewctl/src/index.ts',
        },
        {
          error: '✗ failed (0s) unknown',
          cause: 'Old reviewctl without AUTOGENERATED fix',
          solution:
            'Update branch-review to latest version (includes AUTOGENERATED fix)',
        },
        {
          error: 'Precondition failures: - Plan is MISSING or AMBIGUOUS',
          cause: 'plan.md does not exist or plan_status is invalid',
          solution: 'Run reviewctl plan first, or use reviewctl run --no-plan',
        },
      ],
      quickReference: {
        status: 'bun $REVIEW_CLI status --last',
        help: 'bun $REVIEW_CLI help',
        cleanup: 'bun $REVIEW_CLI cleanup',
        verboseCleanup: 'bun $REVIEW_CLI cleanup --all',
      },
    },
  };

  return NextResponse.json({
    data: info,
    error: null,
  });
}
