import chalk from 'chalk';
import fs from 'fs';
import ora from 'ora';
import path from 'path';
import { AGENT_NAMES, AgentName } from '../lib/constants.js';
import {
  computeHash,
  isValidName,
  sanitizeName,
  ValidationResult,
  validateReport,
} from '../lib/contract-validator.js';
import { getCurrentRun, getRunDir, saveCurrentRun } from '../lib/utils.js';

// Static tools configuration
const STATIC_TOOLS = ['biome', 'ruff', 'pyrefly', 'pytest', 'coderabbit'];

export async function ingestCommand(options: {
  agent?: string;
  static?: string;
  input?: string;
  extra?: boolean;
  overwrite?: boolean;
}) {
  const spinner = ora('Ingesting report...').start();

  try {
    const run = getCurrentRun();
    if (!run) {
      spinner.fail('No active review run. Run: reviewctl init');
      process.exit(1);
    }

    const runDir = getRunDir(run.run_id);
    const reportsDir = path.join(runDir, 'reports');
    const tasksDir = path.join(runDir, 'tasks');
    const staticsDir = path.join(runDir, 'statics');

    // Ensure directories exist
    for (const dir of [reportsDir, tasksDir, staticsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Read input from file or stdin
    let content: string;
    let sourcePath: string | null = null;

    if (options.input) {
      // Validate input path - only block relative paths with traversal
      if (options.input.includes('..') && !path.isAbsolute(options.input)) {
        spinner.fail('Path traversal detected in input path');
        process.exit(1);
      }

      if (!fs.existsSync(options.input)) {
        spinner.fail(`Input file not found: ${options.input}`);
        process.exit(1);
      }
      content = fs.readFileSync(options.input, 'utf-8');
      sourcePath = path.resolve(options.input);
    } else {
      spinner.text = 'Reading from stdin...';
      content = await readStdin();
      sourcePath = 'stdin';
    }

    if (!content || content.trim().length === 0) {
      spinner.fail(
        'No content provided. Use --input <file> or pipe content via stdin.',
      );
      process.exit(1);
    }

    // Determine target: agent or static
    if (options.agent) {
      await ingestAgentReport(
        options.agent,
        content,
        run,
        runDir,
        reportsDir,
        tasksDir,
        spinner,
        sourcePath,
        options.extra || false,
        options.overwrite || false,
      );
    } else if (options.static) {
      await ingestStaticReport(
        options.static,
        content,
        runDir,
        staticsDir,
        spinner,
        sourcePath,
        options.extra || false,
        options.overwrite || false,
      );
    } else {
      spinner.fail('Must specify --agent <name> or --static <tool>');
      console.log(chalk.gray('\n  Agents: ' + AGENT_NAMES.join(', ')));
      console.log(chalk.gray('  Statics: ' + STATIC_TOOLS.join(', ')));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red('Ingest failed'));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

interface PlanJson {
  required_agents: string[];
  optional_agents: string[];
  statics: Array<{ name: string; required: boolean; reason: string }>;
}

function loadPlanJson(runDir: string): PlanJson | null {
  const planJsonPath = path.join(runDir, 'plan.json');
  if (!fs.existsSync(planJsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(planJsonPath, 'utf-8'));
  } catch {
    return null;
  }
}

async function ingestAgentReport(
  agentName: string,
  content: string,
  run: any,
  runDir: string,
  reportsDir: string,
  tasksDir: string,
  spinner: any,
  sourcePath: string | null,
  isExtra: boolean,
  allowOverwrite: boolean,
): Promise<void> {
  // Sanitize and validate agent name
  const sanitizedAgent = sanitizeName(agentName);

  if (!isValidName(sanitizedAgent)) {
    spinner.fail(`Invalid agent name: ${agentName}`);
    console.log(chalk.gray('  Name must match pattern: [a-z0-9-]+'));
    console.log(chalk.gray('  Valid agents: ' + AGENT_NAMES.join(', ')));
    process.exit(1);
  }

  // Check against plan (plan binding)
  const planJson = loadPlanJson(runDir);
  if (planJson && !isExtra) {
    const allPlannedAgents = [
      ...planJson.required_agents,
      ...planJson.optional_agents,
    ];

    if (!allPlannedAgents.includes(sanitizedAgent)) {
      spinner.fail(`Agent "${sanitizedAgent}" is not in the plan`);
      console.log(
        chalk.gray(`  Required agents: ${planJson.required_agents.join(', ')}`),
      );
      console.log(
        chalk.gray(
          `  Optional agents: ${planJson.optional_agents.join(', ') || 'None'}`,
        ),
      );
      console.log(
        chalk.yellow(
          `\n  Use --extra to ingest reports for agents not in the plan`,
        ),
      );
      console.log(
        chalk.yellow(
          `  (Extra reports are stored but not counted toward completion)`,
        ),
      );
      process.exit(1);
    }
  }

  // Check for overwrite protection
  const reportPath = path.join(reportsDir, `reviewer_${sanitizedAgent}.md`);
  if (fs.existsSync(reportPath) && !allowOverwrite) {
    spinner.fail(`Report already exists for agent: ${sanitizedAgent}`);
    console.log(chalk.gray(`  Existing: ${reportPath}`));
    console.log(chalk.yellow(`  Use --overwrite to replace existing report`));
    process.exit(1);
  }

  // Validate against contract
  spinner.text = 'Validating report against SSOT contract...';
  const validation = validateReport(content);

  // Write the report
  fs.writeFileSync(reportPath, content);

  // Create agent task directory
  const agentTaskDir = path.join(tasksDir, sanitizedAgent);
  if (!fs.existsSync(agentTaskDir)) {
    fs.mkdirSync(agentTaskDir, { recursive: true });
  }

  // Determine status based on validation
  const statusValue = validation.valid ? 'DONE' : 'INVALID';

  // Write status.json with hash and metadata
  const statusPath = path.join(agentTaskDir, 'status.json');
  const previousStatus = fs.existsSync(statusPath)
    ? JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
    : {};

  const status = {
    agent: sanitizedAgent,
    status: statusValue,
    requested_at: previousStatus.requested_at || new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    run_id: run.run_id,
    source_path: sourcePath,
    content_hash: computeHash(content),
    is_extra: isExtra,
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      line_count: validation.lineCount,
    },
  };
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  // Write result.json with parsed findings
  const result = parseReport(content, sanitizedAgent as AgentName, run.run_id);
  result.validation = validation;
  fs.writeFileSync(
    path.join(agentTaskDir, 'result.json'),
    JSON.stringify(result, null, 2),
  );

  // Show result
  if (!validation.valid) {
    spinner.warn(
      chalk.yellow(`Report ingested but INVALID: ${sanitizedAgent}`),
    );
    console.log(chalk.red('\n  Contract violations:'));
    for (const err of validation.errors) {
      console.log(chalk.red(`    - ${err}`));
    }
    if (validation.warnings.length > 0) {
      console.log(chalk.yellow('\n  Warnings:'));
      for (const warn of validation.warnings) {
        console.log(chalk.yellow(`    - ${warn}`));
      }
    }
    console.log(chalk.gray(`\n  Status: FAIL (not counted as complete)`));
    console.log(chalk.gray('  Fix the report and re-ingest with --overwrite'));
    process.exit(2);
  }

  spinner.succeed(chalk.green(`Report ingested for agent: ${sanitizedAgent}`));
  console.log(chalk.gray(`  Report: ${reportPath}`));
  console.log(chalk.gray(`  Status: ${statusValue}`));
  console.log(chalk.gray(`  Hash: ${status.content_hash}`));

  if (validation.warnings.length > 0) {
    console.log(chalk.yellow('\n  Warnings:'));
    for (const warn of validation.warnings) {
      console.log(chalk.yellow(`    - ${warn}`));
    }
  }

  // Show completion status
  const stats = checkCompletionStatus(run.run_id, runDir);
  console.log(
    chalk.gray(`\n  Progress: ${stats.completed}/${stats.total} reports valid`),
  );

  if (stats.invalid.length > 0) {
    console.log(chalk.red(`  Invalid: ${stats.invalid.join(', ')}`));
  }

  if (stats.missing.length > 0) {
    console.log(chalk.yellow(`  Missing: ${stats.missing.join(', ')}`));
    console.log(
      chalk.gray(`\n  Next: reviewctl ingest --agent <name> --input <file>`),
    );
  } else {
    console.log(
      chalk.green(`\n  All reports complete! Run: reviewctl verdict`),
    );
  }
}

async function ingestStaticReport(
  toolName: string,
  content: string,
  runDir: string,
  staticsDir: string,
  spinner: any,
  sourcePath: string | null,
  isExtra: boolean,
  allowOverwrite: boolean,
): Promise<void> {
  // Sanitize and validate tool name
  const sanitizedTool = sanitizeName(toolName);

  if (!isValidName(sanitizedTool)) {
    spinner.fail(`Invalid static tool name: ${toolName}`);
    console.log(chalk.gray('  Name must match pattern: [a-z0-9-]+'));
    console.log(chalk.gray('  Valid tools: ' + STATIC_TOOLS.join(', ')));
    process.exit(1);
  }

  // Check against plan (plan binding)
  const planJson = loadPlanJson(runDir);
  if (planJson && !isExtra) {
    const plannedTools = planJson.statics.map((s) => s.name);

    if (!plannedTools.includes(sanitizedTool)) {
      spinner.fail(`Static tool "${sanitizedTool}" is not in the plan`);
      console.log(chalk.gray(`  Planned tools: ${plannedTools.join(', ')}`));
      console.log(
        chalk.yellow(
          `\n  Use --extra to ingest reports for tools not in the plan`,
        ),
      );
      process.exit(1);
    }
  }

  // Check for overwrite protection
  const reportPath = path.join(staticsDir, `${sanitizedTool}.md`);
  if (fs.existsSync(reportPath) && !allowOverwrite) {
    spinner.fail(`Report already exists for static: ${sanitizedTool}`);
    console.log(chalk.gray(`  Existing: ${reportPath}`));
    console.log(chalk.yellow(`  Use --overwrite to replace existing report`));
    process.exit(1);
  }

  // Write the report
  fs.writeFileSync(
    reportPath,
    `# ${sanitizedTool} Analysis\n\n\`\`\`\n${content}\n\`\`\`\n`,
  );

  // Determine if this was required or optional
  let isRequired = false;
  if (planJson) {
    const toolConfig = planJson.statics.find((s) => s.name === sanitizedTool);
    isRequired = toolConfig?.required || false;
  }

  const pytestSummary =
    sanitizedTool === 'pytest' ? parsePytestSummary(content) : null;
  const staticSummary =
    pytestSummary === null
      ? parseStaticSummary(sanitizedTool, content)
      : {
          status: pytestSummary.status,
          reason: pytestSummary.reason,
          issues: pytestSummary.failed + pytestSummary.errors,
        };

  // Write status.json
  const statusPath = path.join(staticsDir, `${sanitizedTool}_status.json`);
  const status = {
    tool: sanitizedTool,
    status: staticSummary.status,
    required: isRequired,
    completed_at: new Date().toISOString(),
    source_path: sourcePath,
    content_hash: computeHash(content),
    is_extra: isExtra,
    execution:
      pytestSummary === null
        ? {
            issues: staticSummary.issues,
            reason: staticSummary.reason,
          }
        : {
            passed: pytestSummary.passed,
            failed: pytestSummary.failed,
            errors: pytestSummary.errors,
            skipped: pytestSummary.skipped,
            coverage_percent: pytestSummary.coveragePercent,
            coverage_threshold: pytestSummary.coverageThreshold,
            coverage_met: pytestSummary.coverageMet,
            reason: pytestSummary.reason,
          },
  };
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  spinner.succeed(chalk.green(`Static analysis ingested: ${sanitizedTool}`));
  console.log(chalk.gray(`  Report: ${reportPath}`));
  console.log(chalk.gray(`  Status: ${status.status}`));
  console.log(chalk.gray(`  Required: ${isRequired}`));
  console.log(chalk.gray(`  Hash: ${status.content_hash}`));
  console.log(chalk.gray(`  Parser: ${staticSummary.reason}`));
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let firstChunkReceived = false;

    process.stdin.setEncoding('utf-8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', (err) => {
      reject(err);
    });

    // Timeout if no input
    setTimeout(() => {
      if (data.length === 0) {
        reject(new Error('No input received from stdin after 5 seconds'));
      }
    }, 5000);

    const onData = (chunk: string) => {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        clearTimeout(timeoutId);
      }

      data += chunk;
    };

    const onEnd = () => {
      cleanup();
      resolve(data);
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

type StaticReviewStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIP';

type StaticSummary = {
  status: StaticReviewStatus;
  reason: string;
  issues: number;
};

type PytestSummary = {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  coveragePercent: number | null;
  coverageThreshold: number;
  coverageMet: boolean | null;
  reason: string;
};

function parseStaticSummary(toolName: string, content: string): StaticSummary {
  if (toolName === 'biome') {
    return parseBiomeSummary(content);
  }

  if (toolName === 'ruff') {
    return parseRuffSummary(content);
  }

  return parseGenericStaticSummary(content, toolName);
}

function parseBiomeSummary(content: string): StaticSummary {
  const normalized = content.toLowerCase();

  if (content.trim().length === 0) {
    return {
      status: 'PASS',
      reason: 'Biome output is empty (no findings reported)',
      issues: 0,
    };
  }

  if (/no files were processed/i.test(content)) {
    return {
      status: 'SKIP',
      reason: 'No files were processed by Biome',
      issues: 0,
    };
  }

  const errors = readCount(content, /Found\s+(\d+)\s+errors?/i);
  const warnings = readCount(content, /Found\s+(\d+)\s+warnings?/i);
  const issues = errors + warnings;

  if (errors > 0 || /some errors were emitted|\bcheck\s+×/i.test(normalized)) {
    return {
      status: 'FAIL',
      reason: `Biome reported ${issues > 0 ? issues : 1} issue(s)`,
      issues: issues > 0 ? issues : 1,
    };
  }

  if (
    /found\s+0\s+errors?/i.test(content) ||
    /checked\s+\d+\s+files/i.test(content)
  ) {
    return {
      status: 'PASS',
      reason: 'Biome output parsed successfully',
      issues: 0,
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'Could not determine Biome result conclusively',
    issues,
  };
}

function parseRuffSummary(content: string): StaticSummary {
  if (/warning:\s+No Python files found/i.test(content)) {
    return {
      status: 'SKIP',
      reason: 'Ruff not applicable: no Python files found',
      issues: 0,
    };
  }

  if (/All checks passed!/i.test(content)) {
    return {
      status: 'PASS',
      reason: 'Ruff reported all checks passed',
      issues: 0,
    };
  }

  const errors = readCount(content, /Found\s+(\d+)\s+errors?/i);
  const hasRuleFindings = /^[^\n:]+:\d+:\d+:\s+[A-Z]\d+/m.test(content);

  if (errors > 0 || hasRuleFindings) {
    return {
      status: 'FAIL',
      reason: `Ruff reported ${errors > 0 ? errors : 1} issue(s)`,
      issues: errors > 0 ? errors : 1,
    };
  }

  if (content.trim().length === 0) {
    return {
      status: 'PASS',
      reason: 'Ruff output is empty (no findings reported)',
      issues: 0,
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'Could not determine Ruff result conclusively',
    issues: errors,
  };
}

function parseGenericStaticSummary(
  content: string,
  toolName: string,
): StaticSummary {
  const normalized = content.toLowerCase();

  if (normalized.trim().length === 0) {
    return {
      status: 'PASS',
      reason: `${toolName} output is empty (no findings reported)`,
      issues: 0,
    };
  }

  if (/all checks passed|no issues found|0 errors?/i.test(content)) {
    return {
      status: 'PASS',
      reason: `${toolName} output indicates success`,
      issues: 0,
    };
  }

  const issues = readCount(content, /Found\s+(\d+)\s+errors?/i);
  if (issues > 0 || /\b(failed|error|violation)s?\b/i.test(normalized)) {
    return {
      status: 'FAIL',
      reason: `${toolName} output indicates blocking issues`,
      issues: issues > 0 ? issues : 1,
    };
  }

  return {
    status: 'UNKNOWN',
    reason: `Could not determine ${toolName} result conclusively`,
    issues,
  };
}

function readCount(content: string, pattern: RegExp): number {
  const match = content.match(pattern);
  return match ? Number(match[1]) : 0;
}

function parsePytestSummary(content: string): PytestSummary {
  const normalized = content.toLowerCase();
  const summaryLine =
    content
      .split('\n')
      .reverse()
      .find((line) =>
        /\b(passed|failed|errors?|skipped|xfailed|xpassed)\b/i.test(line),
      ) || '';

  const readMetric = (name: string): number => {
    const match = summaryLine.match(new RegExp(`(\\d+)\\s+${name}`, 'i'));
    return match ? Number(match[1]) : 0;
  };

  const passed = readMetric('passed');
  const failed = readMetric('failed');
  const errors = readMetric('error') + readMetric('errors');
  const skipped = readMetric('skipped');
  const failedMatch = normalized.match(/\b(\d+)\s+failed\b/i);
  const failedFromText = failedMatch ? Number(failedMatch[1]) : 0;

  const coverageThreshold = Number(
    process.env.REVIEWCTL_PYTEST_COVERAGE_THRESHOLD || '80',
  );
  const coverageMatch = content.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/i);
  const coveragePercent = coverageMatch ? Number(coverageMatch[1]) : null;
  const coverageMet =
    coveragePercent === null ? null : coveragePercent >= coverageThreshold;

  if (failed > 0 || errors > 0 || failedFromText > 0) {
    return {
      status: 'FAIL',
      passed,
      failed,
      errors,
      skipped,
      coveragePercent,
      coverageThreshold,
      coverageMet,
      reason: 'Pytest output indicates failing tests',
    };
  }

  if (passed > 0 || /\b\d+\s+passed\b/i.test(summaryLine)) {
    if (coveragePercent !== null && coverageMet === false) {
      return {
        status: 'FAIL',
        passed,
        failed,
        errors,
        skipped,
        coveragePercent,
        coverageThreshold,
        coverageMet,
        reason: `Coverage below threshold (${coveragePercent}% < ${coverageThreshold}%)`,
      };
    }

    return {
      status: 'PASS',
      passed,
      failed,
      errors,
      skipped,
      coveragePercent,
      coverageThreshold,
      coverageMet,
      reason: 'Pytest output parsed successfully',
    };
  }

  return {
    status: 'UNKNOWN',
    passed,
    failed,
    errors,
    skipped,
    coveragePercent,
    coverageThreshold,
    coverageMet,
    reason: 'Could not determine pytest result conclusively',
  };
}

function parseReport(content: string, agent: AgentName, runId: string): any {
  const result: any = {
    run_id: runId,
    agent,
    timestamp: new Date().toISOString(),
    findings: [],
    statistics: { p0_count: 0, p1_count: 0, p2_count: 0 },
    verdict: { result: 'PASS', justification: 'Parsed from ingested report' },
  };

  // Extract P0 findings
  const p0Matches = content.match(
    /(?:####?\s*|Finding\s+)P0[-\d:]+\s*[:\-]?\s*([^\n]+)/gi,
  );
  if (p0Matches) {
    result.findings.push(
      ...p0Matches.map((m, i) => ({
        id: `P0-${i + 1}`,
        priority: 'P0',
        title: m
          .replace(/(?:####?\s*|Finding\s+)P0[-\d:]+\s*[:\-]?\s*/, '')
          .trim(),
        location: { file: 'Unknown' },
        description: 'Extracted from report',
        evidence: { snippet: 'See full report' },
      })),
    );
  }

  // Extract P1 findings
  const p1Matches = content.match(
    /(?:####?\s*|Finding\s+)P1[-\d:]+\s*[:\-]?\s*([^\n]+)/gi,
  );
  if (p1Matches) {
    result.findings.push(
      ...p1Matches.map((m, i) => ({
        id: `P1-${i + 1}`,
        priority: 'P1',
        title: m
          .replace(/(?:####?\s*|Finding\s+)P1[-\d:]+\s*[:\-]?\s*/, '')
          .trim(),
        location: { file: 'Unknown' },
        description: 'Extracted from report',
        evidence: { snippet: 'See full report' },
      })),
    );
  }

  // Extract P2 findings
  const p2Matches = content.match(
    /(?:####?\s*|Finding\s+)P2[-\d:]+\s*[:\-]?\s*([^\n]+)/gi,
  );
  if (p2Matches) {
    result.findings.push(
      ...p2Matches.map((m, i) => ({
        id: `P2-${i + 1}`,
        priority: 'P2',
        title: m
          .replace(/(?:####?\s*|Finding\s+)P2[-\d:]+\s*[:\-]?\s*/, '')
          .trim(),
        location: { file: 'Unknown' },
        description: 'Extracted from report',
        evidence: { snippet: 'See full report' },
      })),
    );
  }

  // Count statistics
  result.statistics.p0_count = result.findings.filter(
    (f: any) => f.priority === 'P0',
  ).length;
  result.statistics.p1_count = result.findings.filter(
    (f: any) => f.priority === 'P1',
  ).length;
  result.statistics.p2_count = result.findings.filter(
    (f: any) => f.priority === 'P2',
  ).length;

  // Check for PASS/FAIL in verdict section
  if (/##\s*Verdict[^#]*\*\*FAIL\*\*/i.test(content)) {
    result.verdict.result = 'FAIL';
    const justificationMatch = content.match(
      /##\s*Verdict[^#]*\*\*FAIL\*\*\s*[-–]?\s*([^\n]+)/i,
    );
    if (justificationMatch) {
      result.verdict.justification = justificationMatch[1].trim();
    }
  }

  return result;
}

function checkCompletionStatus(
  runId: string,
  runDir: string,
): {
  completed: number;
  total: number;
  missing: string[];
  invalid: string[];
} {
  const reportsDir = path.join(runDir, 'reports');
  const tasksDir = path.join(runDir, 'tasks');
  const planJson = loadPlanJson(runDir);

  // Get required agents from plan
  const requiredAgents = planJson?.required_agents || [];

  // Check status of each required agent
  const missing: string[] = [];
  const invalid: string[] = [];
  let completed = 0;

  for (const agent of requiredAgents) {
    const statusPath = path.join(tasksDir, agent, 'status.json');

    if (!fs.existsSync(statusPath)) {
      missing.push(agent);
      continue;
    }

    try {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));

      if (status.status === 'DONE' && status.validation?.valid) {
        completed++;
      } else if (
        normalizedStatus === 'FAIL' ||
        (status.validation && !status.validation.valid)
      ) {
        invalid.push(agent);
      } else {
        missing.push(agent);
      }
    } catch {
      missing.push(agent);
    }
  }

  return {
    completed,
    total: requiredAgents.length,
    missing,
    invalid,
  };
}
