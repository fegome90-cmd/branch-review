import fs from 'node:fs';
import path from 'node:path';
import {
  type AgentName,
  MAX_AGENTS,
  type RunMetadata,
} from '../lib/constants.js';
import { loadPlanJson } from '../lib/plan-utils.js';
import { detectInteractiveTTY } from '../lib/tui/detection.js';
import { runWithPlainOutput, runWithTUI } from '../lib/tui/run-modes.js';
import type { WorkflowReporter } from '../lib/tui/types.js';
import {
  computeFileDigest,
  getCurrentRun,
  getCurrentSha,
  getRunDir,
  saveCurrentRun,
  validatePreconditions,
} from '../lib/utils.js';

interface RunWorkflowResult {
  runId: string;
  agents: AgentName[];
}

/**
 * Safe file write that throws a contextual error on failure.
 * Used for critical writes where failure should halt the workflow with a clear message.
 */
function safeWriteSync(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content);
  } catch (error) {
    throw new Error(
      `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Execute review workflow: generate static and agent handoff requests.
 *
 * This is the main entry point for running a review.
 *
 * **Workflow phases**:
 * 1. Validate preconditions (review branch, context, diff, plan)
 * 2. Prepare run context (detect drift, resolve plan)
 * 3. Generate static analysis requests (biome, ruff, etc.)
 * 4. Generate agent handoff requests (code-reviewer, etc.)
 * 5. Finalize run state
 *
 * **Drift protection**:
 * - Detects drift by comparing HEAD SHA and file digests
 * - Fails with error unless `--allow-drift` is used
 * - Sets `drift_status` to `DRIFT_OVERRIDE` when allowed
 *
 * @param options - Run command options
 * @param options.backend - Backend to use (reserved for future use)
 * @param options.maxAgents - Maximum number of agents to run (1-3)
 * @param options.timeout - Timeout in minutes per agent
 * @param options.noPlan - Skip plan resolution
 * @param options.plan - Whether to resolve plan (default: true)
 * @param options.allowDrift - Allow drift with override flag
 *
 * @throws {Error} If preconditions not met or drift detected (without --allow-drift)
 *
 * @example
 * ```bash
 * reviewctl run --maxAgents 3
 * reviewctl run --allow-drift  # for debugging
 * ```
 */
export async function runCommand(options: {
  backend?: string;
  maxAgents: string;
  timeout: string;
  noPlan?: boolean;
  plan?: boolean;
  allowDrift?: boolean;
}) {
  const runner = detectInteractiveTTY(process.stdout, process.stderr)
    ? runWithTUI
    : runWithPlainOutput;

  const result = await runner<RunWorkflowResult>({
    commandName: 'run',
    execute: (reporter) => executeRunWorkflow(options, reporter),
  });

  if (result.exitCode === 0 && result.data) {
    console.log(`  Agents: ${result.data.agents.join(', ')}`);
    console.log(
      `  Requests: _ctx/review_runs/${result.data.runId}/reports/REQUEST_*.md`,
    );
    console.log(
      `  Tasks: _ctx/review_runs/${result.data.runId}/tasks/*/status.json`,
    );
    console.log('  Next: Run agents externally, then:');
    console.log('    reviewctl ingest --agent <name> --input <report.md>');
    console.log('    reviewctl verdict');
  }

  process.exit(result.exitCode);
}

async function executeRunWorkflow(
  options: {
    maxAgents: string;
    timeout: string;
    noPlan?: boolean;
    plan?: boolean;
    allowDrift?: boolean;
  },
  reporter: WorkflowReporter,
): Promise<RunWorkflowResult> {
  reporter.setPhase({
    key: 'preconditions',
    label: 'Validating preconditions',
    status: 'RUNNING',
  });

  const preconditions: (
    | 'review_branch'
    | 'context'
    | 'diff'
    | 'plan_resolved'
  )[] = ['review_branch', 'context', 'diff'];

  const skipPlanPrecondition = options.noPlan || options.plan === false;
  if (!skipPlanPrecondition) {
    preconditions.push('plan_resolved');
  }

  validatePreconditions(preconditions);
  reporter.throwIfAborted();

  reporter.setPhase({
    key: 'preconditions',
    label: 'Validating preconditions',
    status: 'DONE',
  });

  reporter.setPhase({
    key: 'prepare',
    label: 'Preparing run context',
    status: 'RUNNING',
  });

  const run = getCurrentRun();
  if (!run) {
    throw new Error('No active review run. Run: reviewctl init');
  }

  const runDir = getRunDir(run.run_id);

  reporter.setRunMeta({
    runId: run.run_id,
    runDir,
  });

  const headNow = getCurrentSha();
  const planPathFromRun = path.join(runDir, 'plan.md');
  const contextPath = path.join(runDir, 'explore', 'context.md');
  const diffPath = path.join(runDir, 'explore', 'diff.md');

  const currentContextDigest = computeFileDigest(contextPath);
  const currentDiffDigest = computeFileDigest(diffPath);
  const currentPlanDigest = computeFileDigest(planPathFromRun);

  const driftReasons: string[] = [];
  if (run.head_sha_at_plan && run.head_sha_at_plan !== headNow) {
    driftReasons.push(`HEAD changed (${run.head_sha_at_plan} -> ${headNow})`);
  }
  if (run.context_digest && !currentContextDigest) {
    driftReasons.push('context snapshot missing');
  } else if (run.context_digest && currentContextDigest && run.context_digest !== currentContextDigest) {
    driftReasons.push('context digest changed since explore');
  }
  if (run.diff_digest && !currentDiffDigest) {
    driftReasons.push('diff snapshot missing');
  } else if (run.diff_digest && currentDiffDigest && run.diff_digest !== currentDiffDigest) {
    driftReasons.push('diff digest changed since explore');
  }
  if (run.plan_digest && !currentPlanDigest) {
    driftReasons.push('plan snapshot missing');
  } else if (run.plan_digest && currentPlanDigest && run.plan_digest !== currentPlanDigest) {
    driftReasons.push('plan digest changed since planning');
  }

  const driftDetected = run.drift_status === 'DRIFT_CONFIRMED' || driftReasons.length > 0;

  if (driftDetected && !options.allowDrift) {
    run.drift_status = 'DRIFT_CONFIRMED';
    saveCurrentRun(run);
    throw new Error(
      `Drift detected: ${driftReasons.join('; ') || 'state marked as DRIFT_CONFIRMED'}. Re-run explore context/diff + plan, or use --allow-drift for debug.`,
    );
  }

  if (driftDetected && options.allowDrift) {
    run.drift_override_used = true;
    run.drift_status = 'DRIFT_OVERRIDE';
    saveCurrentRun(run);
  }

  const maxAgents = Math.max(
    1,
    Math.min(parseInt(options.maxAgents, 10) || MAX_AGENTS, MAX_AGENTS),
  );

  const planPath = path.join(runDir, 'plan.md');
  const hasPlan = fs.existsSync(planPath);

  if (!hasPlan && !skipPlanPrecondition) {
    throw new Error('Review plan not found. Run: reviewctl plan');
  }

  run.status = 'running';
  saveCurrentRun(run);

  const agents = hasPlan
    ? resolveAgentsForRun(runDir, planPath, maxAgents)
    : (['code-reviewer', 'code-simplifier'] as AgentName[]);

  const prepareDetail = hasPlan
    ? `${agents.length} agents selected`
    : 'No plan found (--no-plan), using safe defaults';

  reporter.setPhase({
    key: 'prepare',
    label: 'Preparing run context',
    status: 'DONE',
    detail: prepareDetail,
  });

  reporter.throwIfAborted();

  reporter.setPhase({
    key: 'statics',
    label: 'Generating static requests',
    status: 'RUNNING',
  });

  await generateStaticsRequests(run.run_id, runDir);

  reporter.setPhase({
    key: 'statics',
    label: 'Generating static requests',
    status: 'DONE',
  });

  reporter.throwIfAborted();

  reporter.setPhase({
    key: 'agents',
    label: 'Generating agent requests',
    status: 'RUNNING',
  });

  generateAgentRequests(agents, run, runDir);

  reporter.setPhase({
    key: 'agents',
    label: 'Generating agent requests',
    status: 'DONE',
  });

  reporter.throwIfAborted();

  reporter.setPhase({
    key: 'finalize',
    label: 'Finalizing run state',
    status: 'RUNNING',
  });

  run.status = 'pending_ingest';
  saveCurrentRun(run);

  reporter.setPhase({
    key: 'finalize',
    label: 'Finalizing run state',
    status: 'DONE',
  });

  return {
    runId: run.run_id,
    agents,
  };
}

const VALID_AGENTS = new Set<AgentName>([
  'code-reviewer',
  'code-simplifier',
  'silent-failure-hunter',
  'sql-safety-hunter',
  'pr-test-analyzer',
]);

function normalizeAgents(rawAgents: string[]): AgentName[] {
  const unique = Array.from(new Set(rawAgents));
  return unique.filter((a): a is AgentName => VALID_AGENTS.has(a as AgentName));
}

function parseAgentsFromPlanMarkdown(planPath: string): AgentName[] {
  const content = fs.readFileSync(planPath, 'utf-8');
  const matches = [...content.matchAll(/###\s*Agent:\s*([a-z0-9-]+)/gi)];
  return normalizeAgents(matches.map((m) => m[1]));
}

function resolveAgentsForRun(
  runDir: string,
  planPath: string,
  maxAgents: number,
): AgentName[] {
  const planJson = loadPlanJson(runDir);

  if (planJson) {
    const required = normalizeAgents(planJson.required_agents || []);
    const optional = normalizeAgents(planJson.optional_agents || []).filter(
      (a) => !required.includes(a),
    );

    const effectiveMax = Math.max(maxAgents, required.length);
    const combined: AgentName[] = [...required, ...optional].slice(
      0,
      effectiveMax,
    );

    if (combined.length > 0) {
      return combined;
    }
  }

  const fromMarkdown = parseAgentsFromPlanMarkdown(planPath);
  if (fromMarkdown.length > 0) {
    return fromMarkdown.slice(0, maxAgents);
  }

  const defaults: AgentName[] = [
    'code-reviewer',
    'code-simplifier',
    'pr-test-analyzer',
  ];
  return defaults.slice(0, maxAgents);
}

// Generate static analysis requests - DO NOT RUN, just create requests
async function generateStaticsRequests(
  _runId: string,
  runDir: string,
): Promise<void> {
  const staticsDir = path.join(runDir, 'statics');
  const reportsDir = path.join(runDir, 'reports');

  if (!fs.existsSync(staticsDir)) {
    fs.mkdirSync(staticsDir, { recursive: true });
  }
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Load plan.json to get required/optional statics
  const planJson = loadPlanJson(runDir);

  // All possible static tools
  const staticTools: Array<{
    name: string;
    checkFile: string;
    command: string;
    lang: string;
  }> = [
    {
      name: 'biome',
      checkFile: 'biome.json',
      command: 'bun run lint:biome',
      lang: 'JS/TS',
    },
    {
      name: 'ruff',
      checkFile: 'ruff.toml',
      command: 'bun run lint:ruff',
      lang: 'Python',
    },
    {
      name: 'pytest',
      checkFile: 'pytest.ini',
      command: 'pytest -q',
      lang: 'Python',
    },
    {
      name: 'pyrefly',
      checkFile: 'pyproject.toml',
      command: 'pyrefly check .',
      lang: 'Python',
    },
    {
      name: 'coderabbit',
      checkFile: '.coderabbit.yaml',
      command: 'coderabbit review',
      lang: 'Any',
    },
  ];

  const requestedTools: string[] = [];
  const skippedTools: string[] = [];

  for (const tool of staticTools) {
    // Check if tool is in plan
    const planStatic = planJson?.statics.find((s) => s.name === tool.name);
    const isRequired = planStatic?.required || false;
    const planReason = planStatic?.reason || '';

    const checkPath = path.join(process.cwd(), tool.checkFile);
    const alternateChecks: string[] = [];

    if (tool.name === 'ruff') {
      alternateChecks.push(path.join(process.cwd(), 'pyproject.toml'));
    }

    if (tool.name === 'pytest') {
      alternateChecks.push(path.join(process.cwd(), 'pyproject.toml'));
      alternateChecks.push(path.join(process.cwd(), 'tests'));
    }

    // Check if tool config/capability exists
    const configExists =
      fs.existsSync(checkPath) ||
      alternateChecks.some((candidate) => fs.existsSync(candidate));

    // Determine if we should generate a request or skip
    const shouldGenerate = configExists || (planJson && isRequired);

    if (shouldGenerate) {
      // Generate request
      const requestContent = generateStaticsRequestMd(
        tool,
        isRequired,
        planReason,
      );
      safeWriteSync(
        path.join(reportsDir, `REQUEST_statics_${tool.name}.md`),
        requestContent,
      );

      // Mark as PENDING
      const statusPath = path.join(staticsDir, `${tool.name}_status.json`);
      safeWriteSync(
        statusPath,
        JSON.stringify(
          {
            tool: tool.name,
            status: configExists ? 'PENDING' : 'PENDING_NO_CONFIG',
            required: isRequired,
            reason: planReason,
            requested_at: new Date().toISOString(),
            command: tool.command,
          },
          null,
          2,
        ),
      );

      requestedTools.push(tool.name);
    } else {
      // SKIP - not in plan or no config
      safeWriteSync(
        path.join(staticsDir, `${tool.name}.md`),
        `# ${tool.name} Analysis\n\nSKIP: ${configExists ? 'Not in plan' : `${tool.checkFile} not found`}`,
      );
      safeWriteSync(
        path.join(staticsDir, `${tool.name}_status.json`),
        JSON.stringify(
          {
            tool: tool.name,
            status: 'SKIP',
            required: false,
            reason: configExists
              ? 'Not in plan'
              : `${tool.checkFile} not found`,
          },
          null,
          2,
        ),
      );
      skippedTools.push(tool.name);
    }
  }

  // Generate combined statics request if any tools were requested
  if (requestedTools.length > 0) {
    const combinedRequest = `# Static Analysis Requests

## Tools Requiring Execution

${requestedTools.map((t) => `- **${t}**: See REQUEST_statics_${t}.md`).join('\n')}

## How to Run

Execute each tool and ingest the output:

\`\`\`bash
# Example for biome
bun run lint:biome > /tmp/biome-output.md
reviewctl ingest --static biome --input /tmp/biome-output.md

# Example for ruff
bun run lint:ruff > /tmp/ruff-output.md
reviewctl ingest --static ruff --input /tmp/ruff-output.md

# Example for pytest
pytest -q > /tmp/pytest-output.md
reviewctl ingest --static pytest --input /tmp/pytest-output.md
\`\`\`

## Status Files

Each tool has a status file in \`statics/<tool>_status.json\`:
- PENDING: Awaiting execution
- PASS: Tool executed without blocking findings
- FAIL: Tool execution found blocking issues
- UNKNOWN: Output ingested but parser could not determine conclusive status
- SKIP: Not applicable for current stack/config

---
_Generated by reviewctl_
`;
    safeWriteSync(path.join(reportsDir, 'REQUEST_statics.md'), combinedRequest);
  }
}

function generateStaticsRequestMd(
  tool: { name: string; command: string; lang: string },
  isRequired: boolean,
  planReason: string,
): string {
  const executionHint =
    tool.name === 'pytest'
      ? `\nOptional coverage mode:\n\`\`\`bash\npytest --cov --cov-report=term-missing > /tmp/${tool.name}-output.md 2>&1\n\`\`\``
      : '';

  return `# Static Analysis Request: ${tool.name}

## Tool Information
- **Name**: ${tool.name}
- **Language**: ${tool.lang}
- **Command**: \`${tool.command}\`
- **Required**: ${isRequired ? 'Yes' : 'No (optional)'}
- **Reason**: ${planReason || 'Not specified in plan'}

## Execution Instructions

1. Run the command from the repository root:
   \`\`\`bash
   ${tool.command} > /tmp/${tool.name}-output.md 2>&1
   \`\`\`
${executionHint}

2. Ingest the output:
   \`\`\`bash
   reviewctl ingest --static ${tool.name} --input /tmp/${tool.name}-output.md
   \`\`\`

## Expected Output Format

The output should include:
- List of issues found (if any)
- File locations
- Severity levels

## Status

- **Current**: PENDING
- **Required**: ${isRequired ? 'Yes' : 'No'}
- **Updated**: ${new Date().toISOString()}

---
_Generated by reviewctl_
`;
}

// Generate agent handoff requests - NO SIMULATION
function generateAgentRequests(
  agents: AgentName[],
  run: RunMetadata,
  runDir: string,
): void {
  const reportsDir = path.join(runDir, 'reports');
  const tasksDir = path.join(runDir, 'tasks');

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  for (const agent of agents) {
    // Create agent task directory
    const agentTaskDir = path.join(tasksDir, agent);
    if (!fs.existsSync(agentTaskDir)) {
      fs.mkdirSync(agentTaskDir, { recursive: true });
    }

    // Generate handoff request
    const requestContent = generateAgentRequestMd(agent, run);
    safeWriteSync(path.join(reportsDir, `REQUEST_${agent}.md`), requestContent);

    // Write status = PENDING
    const statusPath = path.join(agentTaskDir, 'status.json');
    safeWriteSync(
      statusPath,
      JSON.stringify(
        {
          agent,
          status: 'PENDING',
          requested_at: new Date().toISOString(),
          run_id: run.run_id,
        },
        null,
        2,
      ),
    );

    // Write prompt for external agent to use
    const prompt = generateAgentPrompt(agent, run);
    safeWriteSync(path.join(agentTaskDir, 'prompt.md'), prompt);
  }
}

function generateAgentRequestMd(agent: AgentName, run: RunMetadata): string {
  const mission = getAgentMission(agent);
  const timestamp = new Date().toISOString();

  return `# Agent Handoff Request: ${agent}

## Run Information
- **Run ID**: ${run.run_id}
- **Review Branch**: ${run.branch}
- **Target Branch**: ${run.target_branch || run.branch}
- **Base Branch**: ${run.base_branch}
- **Timestamp**: ${timestamp}

## Agent Mission

${mission}

## Context Files

Before executing, review these context files:
- \`explore/context.md\` - Stack detection, sensitive zones
- \`explore/diff.md\` - Change analysis, drift check
- \`plan.md\` - Review plan and focus areas

## Output Requirements

Generate a report following \`report_contract.md\`.

### Required sections (ERROR if missing)
1. **Meta section**: Run ID, agent, timestamp
2. **Summary**: 1-2 sentences
3. **Findings**: P0/P1/P2 with evidence
4. **Verdict**: PASS or FAIL with justification

### Recommended sections (WARN if missing)
1. **Test Plan**
2. **Confidence**
3. **Statistics**: Count by priority

### Constraints
- **Output Limit**: ≤120 lines
- **Evidence Required**: Every finding needs code location + snippet
- **Priority Format**: P0 (blocking) | P1 (important) | P2 (minor)

## How to Submit Output

After generating your report:

\`\`\`bash
reviewctl ingest --agent ${agent} --input <report-file.md>
\`\`\`

Or pipe directly:

\`\`\`bash
cat <<'EOF' | reviewctl ingest --agent ${agent}
# Report: ${agent}
...your report content...
EOF
\`\`\`

## Status

- **Current**: PENDING
- **Required**: Yes (mandatory agent)

---
_Generated by reviewctl - Handoff Generator_
`;
}

function generateAgentPrompt(agent: AgentName, run: RunMetadata): string {
  return `## Context
- **Run ID**: ${run.run_id}
- **Review Branch**: ${run.branch}
- **Target Branch**: ${run.target_branch || run.branch}
- **Base Branch**: ${run.base_branch}
- **Stack**: Auto-detected (see explore/context.md)
- **Plan Source**: ${run.plan_status}

## Scope
- **Files Changed**: See explore/diff.md
- **Lines Changed**: See explore/diff.md
- **Hotspots**: See explore/context.md

## Mission
${getAgentMission(agent)}

## Constraints
- **Output Limit**: ≤120 lines
- **Format**: Markdown with structured sections
- **Evidence Required**: Every finding needs code location + snippet
- **Priority Format**: P0|P1|P2 with justification

## Output Format
Follow report_contract.md structure exactly.
`;
}

function getAgentMission(agent: AgentName): string {
  const missions: Record<AgentName, string> = {
    'code-reviewer':
      'Review code for correctness, patterns, and best practices. Identify bugs, security issues, and code smells.',
    'code-simplifier':
      'Identify opportunities to reduce complexity and improve readability. Focus on maintainability.',
    'silent-failure-hunter':
      'Identify silent failures, swallowed exceptions, and error handling issues that could hide bugs.',
    'sql-safety-hunter':
      'Identify SQL injection risks, unsafe queries, and database safety issues.',
    'pr-test-analyzer':
      'Verify test coverage for changed code and analyze PR quality.',
  };
  return missions[agent];
}
