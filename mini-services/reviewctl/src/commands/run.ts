import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { AgentName, DEFAULT_TIMEOUT_MINS, MAX_AGENTS, REVIEW_RUNS_DIR } from '../lib/constants.js';
import { loadPlanJson } from '../lib/plan-utils.js';
import { getCurrentRun, getRunDir, saveCurrentRun, validatePreconditions } from '../lib/utils.js';

export async function runCommand(options: {
  backend?: string;
  maxAgents: string;
  timeout: string;
  noPlan?: boolean;
  plan?: boolean;
}) {
  const spinner = ora('Starting review run...').start();

  try {
    // Validate preconditions
    const preconditions: ('review_branch' | 'context' | 'diff' | 'plan_resolved')[] = [
      'review_branch',
      'context',
      'diff',
    ];
    const skipPlanPrecondition = options.noPlan || options.plan === false;

    if (!skipPlanPrecondition) {
      preconditions.push('plan_resolved');
    }

    validatePreconditions(preconditions);

    const run = getCurrentRun();
    if (!run) {
      spinner.fail('No active review run. Run: reviewctl init');
      process.exit(1);
    }

    // Check drift status
    if (run.drift_status === 'DRIFT_CONFIRMED') {
      spinner.fail('DRIFT_CONFIRMED blocks review run. Resolve drift issues first.');
      process.exit(1);
    }

    // Parse options
    const maxAgents = Math.min(parseInt(options.maxAgents) || MAX_AGENTS, MAX_AGENTS);
    const timeoutMins = parseInt(options.timeout) || DEFAULT_TIMEOUT_MINS;

    // Load plan
    const runDir = getRunDir(run.run_id);
    const planPath = path.join(runDir, 'plan.md');
    const hasPlan = fs.existsSync(planPath);

    if (!hasPlan && !skipPlanPrecondition) {
      spinner.fail('Review plan not found. Run: reviewctl plan');
      process.exit(1);
    }

    // Update run status
    run.status = 'running';
    saveCurrentRun(run);

    // Parse agents from plan (plan.json is source of truth).
    // Note: explicit --no-plan intentionally uses a minimal safe set, while
    // resolveAgentsForRun() falls back to a fuller default that includes pr-test-analyzer.
    const agents = hasPlan
      ? resolveAgentsForRun(runDir, planPath, maxAgents)
      : (['code-reviewer', 'code-simplifier'] as AgentName[]);

    spinner.text = `Generating handoff requests for ${agents.length} agents...`;
    if (!hasPlan) {
      spinner.text =
        'No plan found (--no-plan). Using default agents: code-reviewer, code-simplifier';
    }

    // Generate static analysis requests
    await generateStaticsRequests(run.run_id, runDir);

    // Generate agent handoff requests (NO SIMULATION)
    generateAgentRequests(agents, run, runDir);

    // Update run status
    run.status = 'pending_ingest';
    saveCurrentRun(run);

    spinner.succeed(chalk.green('Review run prepared - handoff requests generated'));

    console.log(chalk.gray(`\n  Agents: ${agents.join(', ')}`));
    console.log(chalk.gray(`  Requests: _ctx/review_runs/${run.run_id}/reports/REQUEST_*.md`));
    console.log(chalk.gray(`  Tasks: _ctx/review_runs/${run.run_id}/tasks/*/status.json`));
    console.log(chalk.yellow(`\n  Next: Run agents externally, then:`));
    console.log(chalk.yellow(`    reviewctl ingest --agent <name> --input <report.md>`));
    console.log(chalk.yellow(`    reviewctl verdict`));
  } catch (error) {
    spinner.fail(chalk.red('Review run failed'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
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

function resolveAgentsForRun(runDir: string, planPath: string, maxAgents: number): AgentName[] {
  const planJson = loadPlanJson(runDir);

  if (planJson) {
    const required = normalizeAgents(planJson.required_agents || []);
    const optional = normalizeAgents(planJson.optional_agents || []).filter(
      (a) => !required.includes(a)
    );

    const effectiveMax = Math.max(maxAgents, required.length);
    const combined: AgentName[] = [...required, ...optional].slice(0, effectiveMax);

    if (combined.length > 0) {
      return combined;
    }
  }

  const fromMarkdown = parseAgentsFromPlanMarkdown(planPath);
  if (fromMarkdown.length > 0) {
    return fromMarkdown.slice(0, maxAgents);
  }

  const defaults: AgentName[] = ['code-reviewer', 'code-simplifier', 'pr-test-analyzer'];
  return defaults.slice(0, maxAgents);
}

// Generate static analysis requests - DO NOT RUN, just create requests
async function generateStaticsRequests(runId: string, runDir: string): Promise<void> {
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
      command: 'ruff check .',
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
      fs.existsSync(checkPath) || alternateChecks.some((candidate) => fs.existsSync(candidate));

    // Determine if we should generate a request or skip
    const shouldGenerate = configExists || (planJson && isRequired);

    if (shouldGenerate) {
      // Generate request
      const requestContent = generateStaticsRequestMd(tool, isRequired, planReason);
      fs.writeFileSync(path.join(reportsDir, `REQUEST_statics_${tool.name}.md`), requestContent);

      // Mark as PENDING
      const statusPath = path.join(staticsDir, `${tool.name}_status.json`);
      fs.writeFileSync(
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
          2
        )
      );

      requestedTools.push(tool.name);
    } else {
      // SKIP - not in plan or no config
      fs.writeFileSync(
        path.join(staticsDir, `${tool.name}.md`),
        `# ${tool.name} Analysis\n\nSKIP: ${configExists ? 'Not in plan' : tool.checkFile + ' not found'}`
      );
      fs.writeFileSync(
        path.join(staticsDir, `${tool.name}_status.json`),
        JSON.stringify(
          {
            tool: tool.name,
            status: 'SKIP',
            required: false,
            reason: configExists ? 'Not in plan' : `${tool.checkFile} not found`,
          },
          null,
          2
        )
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
ruff check . > /tmp/ruff-output.md
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
    fs.writeFileSync(path.join(reportsDir, 'REQUEST_statics.md'), combinedRequest);
  }
}

function generateStaticsRequestMd(
  tool: { name: string; command: string; lang: string },
  isRequired: boolean,
  planReason: string
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
function generateAgentRequests(agents: AgentName[], run: any, runDir: string): void {
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
    fs.writeFileSync(path.join(reportsDir, `REQUEST_${agent}.md`), requestContent);

    // Write status = PENDING
    const statusPath = path.join(agentTaskDir, 'status.json');
    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          agent,
          status: 'PENDING',
          requested_at: new Date().toISOString(),
          run_id: run.run_id,
        },
        null,
        2
      )
    );

    // Write prompt for external agent to use
    const prompt = generateAgentPrompt(agent, run);
    fs.writeFileSync(path.join(agentTaskDir, 'prompt.md'), prompt);
  }
}

function generateAgentRequestMd(agent: AgentName, run: any): string {
  const mission = getAgentMission(agent);
  const timestamp = new Date().toISOString();

  return `# Agent Handoff Request: ${agent}

## Run Information
- **Run ID**: ${run.run_id}
- **Branch**: ${run.branch}
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

Generate a report following \`report_contract.md\`:

1. **Meta section**: Run ID, agent, timestamp
2. **Summary**: 1-2 sentences
3. **Findings**: P0/P1/P2 with evidence
4. **Statistics**: Count by priority
5. **Verdict**: PASS or FAIL with justification

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

function generateAgentPrompt(agent: AgentName, run: any): string {
  return `## Context
- **Run ID**: ${run.run_id}
- **Branch**: ${run.branch}
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
    'pr-test-analyzer': 'Verify test coverage for changed code and analyze PR quality.',
  };
  return missions[agent];
}
