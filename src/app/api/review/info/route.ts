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
      unauthenticated: {
        requests: 30,
        windowMs: 60000,
      },
      commandExecution: {
        requests: 10,
        windowMs: 60000,
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
      { code: 'MISCONFIGURED', httpStatus: 503 },
      { code: 'INTERNAL_ERROR', httpStatus: 500 },
    ],
    workflow: [
      'POST /api/review/command {"command": "init"}',
      'POST /api/review/command {"command": "explore", "args": {"mode": "context"}}',
      'POST /api/review/command {"command": "explore", "args": {"mode": "diff"}}',
      'POST /api/review/command {"command": "plan"}',
      'POST /api/review/command {"command": "run"}',
      'POST /api/review/command {"command": "ingest", "args": {"agent": "<name>"}}',
      'POST /api/review/command {"command": "verdict"}',
      'GET /api/review/final?runId=<run-id>',
    ],
    documentation: '/docs/agent-task-card.md',
  };

  return NextResponse.json({
    data: info,
    error: null,
  });
}
