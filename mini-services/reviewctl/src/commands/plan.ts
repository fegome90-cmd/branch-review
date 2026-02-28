import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { ReviewLevel, ReviewType } from '../lib/constants.js';
import { resolvePlan, savePlanRef } from '../lib/plan-resolver.js';
import {
  detectSensitiveZones,
  detectStack,
  determineReviewType,
  determineThirdAgent,
} from '../lib/stack-detector.js';
import {
  computeDigest,
  getChangedFiles,
  getCurrentRun,
  getCurrentSha,
  getDiffStats,
  getRunDir,
  saveCurrentRun,
  validatePreconditions,
} from '../lib/utils.js';

/**
 * Generate or display review plan.
 *
 * Resolves plan from docs/plans/ directory based on stack detection,
 * or uses custom plan specified by `--plan-path`.
 *
 * Records plan digest and HEAD SHA for drift detection.
 *
 * @param options - Plan command options
 * @param options.planPath - Path to custom plan file (optional)
 *
 * @throws {Error} If plan cannot be resolved or file doesn't exist
 *
 * @example
 * ```bash
 * reviewctl plan                    # Auto-resolve plan from stack
 * reviewctl plan --plan-path docs/my-plan.md  # Use custom plan
 * ```
 */
export async function planCommand(options: {
  level: string;
  type: string;
  planPath?: string;
}) {
  const spinner = ora('Generating review plan...').start();

  try {
    // Validate preconditions
    validatePreconditions(['context', 'diff']);

    const run = getCurrentRun();
    if (!run) {
      spinner.fail('No active review run. Run: reviewctl init');
      process.exit(1);
    }

    // Resolve plan if not set
    if (run.plan_status !== 'FOUND' || options.planPath) {
      if (options.planPath) {
        if (!fs.existsSync(options.planPath)) {
          spinner.fail(`Plan file not found: ${options.planPath}`);
          process.exit(1);
        }
        run.plan_path = options.planPath;
        run.plan_status = 'FOUND';
        savePlanRef(run.run_id, options.planPath);
        saveCurrentRun(run);
      } else {
        const planResult = await resolvePlan();
        if (
          planResult.status === 'MISSING' ||
          planResult.status === 'AMBIGUOUS'
        ) {
          spinner.warn(
            chalk.yellow(
              'Plan is MISSING or AMBIGUOUS. Use --plan-path to specify.',
            ),
          );
          console.log(chalk.gray('  Continuing with plan-less review...'));
        } else {
          run.plan_path = planResult.path || undefined;
          run.plan_status = planResult.status;
          savePlanRef(run.run_id, planResult.path!);
          saveCurrentRun(run);
        }
      }
    }

    spinner.text = 'Detecting stack and determining review parameters...';
    const stack = await detectStack();
    const changedFiles = getChangedFiles();
    const sensitiveZones = detectSensitiveZones(changedFiles);
    const diffStats = getDiffStats();

    // Determine level and type
    let level: ReviewLevel = options.level as ReviewLevel;
    let type: ReviewType = options.type as ReviewType;

    if (level === 'auto') {
      level = determineReviewLevel(diffStats, sensitiveZones);
    }

    if (type === 'auto') {
      type = determineReviewType(
        stack,
        changedFiles,
        sensitiveZones,
      ) as ReviewType;
    }

    // Determine agents
    const thirdAgent = determineThirdAgent(stack, sensitiveZones);
    const agents = ['code-reviewer', 'code-simplifier', thirdAgent];

    // Generate plan
    spinner.text = 'Generating review plan...';
    const planContent = generatePlanMd(
      run,
      level,
      type,
      agents,
      stack,
      sensitiveZones,
      diffStats,
      changedFiles,
    );

    // Save plan
    const runDir = getRunDir(run.run_id);
    const planPath = path.join(runDir, 'plan.md');
    fs.writeFileSync(planPath, planContent);

    // Generate plan.json with required_agents and statics
    const planJson = generatePlanJson(run, level, type, agents, stack);
    fs.writeFileSync(
      path.join(runDir, 'plan.json'),
      JSON.stringify(planJson, null, 2),
    );

    // Update run status + digest snapshots
    run.status = 'planning';
    run.head_sha_at_plan = getCurrentSha();
    run.plan_digest = computeDigest(planContent);
    saveCurrentRun(run);

    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));

    spinner.succeed(chalk.green('Review plan generated'));

    console.log(chalk.gray(`\n  Level: ${level}`));
    console.log(chalk.gray(`  Type: ${type}`));
    console.log(chalk.gray(`  Agents: ${agents.join(', ')}`));
    console.log(chalk.gray(`  Output: _ctx/review_runs/${run.run_id}/plan.md`));
    console.log(chalk.gray(`\n  Next: reviewctl run`));
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate plan'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

function determineReviewLevel(
  diffStats: { files: number; added: number; removed: number },
  zones: Array<{ zone: string; riskLevel: string }>,
): ReviewLevel {
  const hasHighRisk = zones.some((z) => z.riskLevel === 'HIGH');
  const largeChange =
    diffStats.files > 20 || diffStats.added + diffStats.removed > 500;
  const mediumChange =
    diffStats.files > 5 || diffStats.added + diffStats.removed > 100;

  if (hasHighRisk && largeChange) return 'comprehensive';
  if (hasHighRisk || largeChange) return 'thorough';
  if (mediumChange) return 'thorough';
  return 'quick';
}

function generatePlanMd(
  run: any,
  level: ReviewLevel,
  type: ReviewType,
  agents: string[],
  stack: any,
  zones: any[],
  diffStats: any,
  changedFiles: string[],
): string {
  const timestamp = new Date().toISOString();

  return `# Review Plan

## Run Information
- **Run ID**: ${run.run_id}
- **Branch**: ${run.branch}
- **Base Branch**: ${run.base_branch}
- **Generated**: ${timestamp}

## Review Configuration

| Parameter | Value |
|-----------|-------|
| Level | ${level} |
| Type | ${type} |
| Max Agents | 3 |
| Timeout | 8 minutes |

## Scope Summary

| Metric | Value |
|--------|-------|
| Files Changed | ${diffStats.files} |
| Lines Added | ${diffStats.added} |
| Lines Removed | ${diffStats.removed} |
| Sensitive Zones | ${zones.length} |

## Plan Source

- **Status**: ${run.plan_status}
- **Path**: ${run.plan_path || 'N/A'}

## Agent Assignments

### Mandatory Agents (Always Run)

| Agent | Focus Area |
|-------|------------|
| code-reviewer | General code quality, patterns, best practices |
| code-simplifier | Complexity reduction, readability, maintainability |

### Third Agent (Stack-Based)

| Agent | Reason |
|-------|--------|
| ${agents[2]} | ${getThirdAgentReason(agents[2], stack, zones)} |

## Task Breakdown

### Agent: code-reviewer

**Mission**: Review code for correctness, patterns, and best practices.

**Focus Areas**:
${zones.map((z) => `- ${z.zone} (${z.riskLevel} risk)`).join('\n')}

**Constraints**:
- Output limit: ≤120 lines
- Format: Markdown with structured sections
- Evidence required for all findings

---

### Agent: code-simplifier

**Mission**: Identify opportunities to reduce complexity and improve readability.

**Focus Areas**:
- Complex conditionals
- Deep nesting
- Long functions
- Duplicate code

**Constraints**:
- Output limit: ≤120 lines
- Format: Markdown with structured sections
- Evidence required for all findings

---

### Agent: ${agents[2]}

**Mission**: ${getThirdAgentMission(agents[2])}

**Focus Areas**:
${getThirdAgentFocus(agents[2], changedFiles)}

**Constraints**:
- Output limit: ≤120 lines
- Format: Markdown with structured sections
- Evidence required for all findings

---

## Static Analysis

| Tool | Status | Command |
|------|--------|---------|
| biome | ${stack.languages.includes('TypeScript') || stack.languages.includes('JavaScript') ? 'RUN' : 'SKIP'} | bun run lint:biome |
| ruff | ${stack.languages.includes('Python') ? 'RUN' : 'SKIP'} | bun run lint:ruff |
| pytest | ${stack.languages.includes('Python') ? 'RUN' : 'SKIP'} | pytest -q |

---

## Execution Order

1. Run static analysis tools
2. Execute code-reviewer agent
3. Execute code-simplifier agent
4. Execute ${agents[2]} agent
5. Aggregate results
6. Generate verdict

---

## Success Criteria

- **PASS**: No P0 findings
- **FAIL**: One or more P0 findings
- **Review complete**: All agents finished within timeout

_Generated by reviewctl v1.0_
`;
}

function getThirdAgentReason(
  agent: string,
  _stack: any,
  _zones: any[],
): string {
  switch (agent) {
    case 'silent-failure-hunter':
      return 'Python codebase with API/DB changes - check for silent error handling';
    case 'sql-safety-hunter':
      return 'SQL/Database changes detected - check for injection risks';
    case 'pr-test-analyzer':
      return 'Default third agent - verify test coverage and PR quality';
    default:
      return 'Stack-based selection';
  }
}

function getThirdAgentMission(agent: string): string {
  switch (agent) {
    case 'silent-failure-hunter':
      return 'Identify silent failures, swallowed exceptions, and error handling issues.';
    case 'sql-safety-hunter':
      return 'Identify SQL injection risks, unsafe queries, and database safety issues.';
    case 'pr-test-analyzer':
      return 'Verify test coverage, PR quality, and integration test scenarios.';
    default:
      return 'Perform specialized review based on detected stack.';
  }
}

function getThirdAgentFocus(agent: string, changedFiles: string[]): string {
  const testFiles = changedFiles.filter((f) => /test|spec/i.test(f));
  const sqlFiles = changedFiles.filter((f) =>
    /\.sql$|schema|migration/i.test(f),
  );
  const apiFiles = changedFiles.filter((f) => /api|route/i.test(f));

  switch (agent) {
    case 'silent-failure-hunter':
      return (
        apiFiles.map((f) => `- ${f}`).join('\n') || '- No API files detected'
      );
    case 'sql-safety-hunter':
      return (
        sqlFiles.map((f) => `- ${f}`).join('\n') || '- No SQL files detected'
      );
    case 'pr-test-analyzer':
      return (
        testFiles.map((f) => `- ${f}`).join('\n') || '- No test files changed'
      );
    default:
      return '- Review all changed files';
  }
}

// Generate plan.json with required_agents and statics
interface PlanJson {
  run_id: string;
  level: string;
  type: string;
  required_agents: string[];
  optional_agents: string[];
  statics: {
    name: string;
    required: boolean;
    reason: string;
  }[];
  max_agents: number;
  timeout_mins: number;
  generated_at: string;
}

function generatePlanJson(
  run: any,
  level: ReviewLevel,
  type: ReviewType,
  agents: string[],
  stack: any,
): PlanJson {
  // code-reviewer and code-simplifier are ALWAYS required
  const requiredAgents = ['code-reviewer', 'code-simplifier'];

  // Third agent is required for thorough+ levels, optional for quick
  const optionalAgents: string[] = [];
  if (level === 'quick') {
    optionalAgents.push(agents[2]);
  } else {
    requiredAgents.push(agents[2]);
  }

  // Statics configuration
  const statics: PlanJson['statics'] = [];

  // biome - required for TS/JS projects
  if (
    stack.languages.includes('TypeScript') ||
    stack.languages.includes('JavaScript')
  ) {
    statics.push({
      name: 'biome',
      required: level !== 'quick',
      reason: 'JS/TS linter and formatter',
    });
  } else {
    statics.push({
      name: 'biome',
      required: false,
      reason: 'Not applicable - no JS/TS detected',
    });
  }

  // ruff - required for Python projects
  if (stack.languages.includes('Python')) {
    statics.push({
      name: 'ruff',
      required: level !== 'quick',
      reason: 'Python linter and formatter',
    });
  } else {
    statics.push({
      name: 'ruff',
      required: false,
      reason: 'Not applicable - no Python detected',
    });
  }

  // pytest - required for Python projects (execution gate)
  if (stack.languages.includes('Python')) {
    statics.push({
      name: 'pytest',
      required: level !== 'quick',
      reason: 'Python test execution gate',
    });
  } else {
    statics.push({
      name: 'pytest',
      required: false,
      reason: 'Not applicable - no Python detected',
    });
  }

  // pyrefly - optional for Python projects
  if (stack.languages.includes('Python')) {
    statics.push({
      name: 'pyrefly',
      required: false,
      reason: 'Python type checker (optional)',
    });
  }

  // coderabbit - always optional (AI external review)
  statics.push({
    name: 'coderabbit',
    required: false,
    reason: 'AI external review (optional)',
  });

  return {
    run_id: run.run_id,
    level,
    type,
    required_agents: requiredAgents,
    optional_agents: optionalAgents,
    statics,
    max_agents: 3,
    timeout_mins: 8,
    generated_at: new Date().toISOString(),
  };
}
