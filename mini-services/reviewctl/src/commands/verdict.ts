import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  REVIEW_RUNS_DIR,
  FinalResult,
  Verdict
} from '../lib/constants.js';
import {
  getCurrentRun,
  getRunDir,
  saveCurrentRun,
  getDiffStats
} from '../lib/utils.js';

export async function verdictCommand(options: { json?: boolean; allowIncomplete?: boolean }) {
  const spinner = ora('Generating verdict...').start();
  
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
    
    // Check if reports directory exists
    if (!fs.existsSync(reportsDir)) {
      spinner.fail('No reports directory found. Run: reviewctl run');
      process.exit(1);
    }
    
    // Check for missing reports
    spinner.text = 'Checking report completion status...';
    const completionStatus = checkCompletionStatus(runDir, reportsDir, tasksDir);
    
    // Check for INVALID reports (higher priority than missing)
    if (completionStatus.invalid.length > 0 && !options.allowIncomplete) {
      spinner.warn(chalk.yellow('INVALID: Reports failed contract validation'));
      
      console.log(chalk.gray(`\n  Completed: ${completionStatus.completed}/${completionStatus.total}`));
      console.log(chalk.red(`  Invalid: ${completionStatus.invalid.join(', ')}`));
      
      for (const agent of completionStatus.invalid) {
        const details = completionStatus.invalidDetails[agent] || [];
        console.log(chalk.red(`\n  ${agent}:`));
        for (const err of details) {
          console.log(chalk.red(`    - ${err}`));
        }
      }
      
      console.log(chalk.yellow('\n  Fix the invalid reports and re-ingest with --overwrite'));
      
      // Write partial result
      const partialJson = {
        run_id: run.run_id,
        verdict: 'INVALID',
        status: 'invalid_reports',
        required_agents: completionStatus.required,
        completed_agents: completionStatus.completed,
        missing_agents: completionStatus.missing,
        invalid_agents: completionStatus.invalid,
        invalid_details: completionStatus.invalidDetails,
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(path.join(runDir, 'final.json'), JSON.stringify(partialJson, null, 2));
      
      // Exit code 2 for INCOMPLETE/INVALID
      process.exit(2);
    }
    
    if (completionStatus.missing.length > 0 && !options.allowIncomplete) {
      spinner.warn(chalk.yellow('INCOMPLETE: Missing required reports'));
      
      console.log(chalk.gray(`\n  Completed: ${completionStatus.completed}/${completionStatus.total}`));
      console.log(chalk.red(`  Missing: ${completionStatus.missing.join(', ')}`));
      console.log(chalk.gray('\n  To ingest missing reports:'));
      for (const agent of completionStatus.missing) {
        console.log(chalk.gray(`    reviewctl ingest --agent ${agent} --input <report.md>`));
      }
      console.log(chalk.gray('\n  Or use --allow-incomplete to generate verdict anyway'));
      
      // Write partial result
      const partialJson = {
        run_id: run.run_id,
        verdict: 'INCOMPLETE',
        status: 'pending_reports',
        required_agents: completionStatus.required,
        completed_agents: completionStatus.completed,
        missing_agents: completionStatus.missing,
        invalid_agents: completionStatus.invalid,
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(path.join(runDir, 'final.json'), JSON.stringify(partialJson, null, 2));
      
      // Exit code 2 for INCOMPLETE
      process.exit(2);
    }
    
    // Aggregate all reports
    spinner.text = 'Aggregating agent reports...';
    const aggregated = aggregateReports(reportsDir, tasksDir, staticsDir, run);
    
    // Generate verdict
    const verdict = determineVerdict(aggregated);
    
    // Generate final.md
    spinner.text = 'Generating final report...';
    const finalMd = generateFinalMd(aggregated, verdict, run, completionStatus);
    fs.writeFileSync(path.join(runDir, 'final.md'), finalMd);
    
    // Generate final.json
    const finalJson = generateFinalJson(aggregated, verdict, run, completionStatus);
    fs.writeFileSync(path.join(runDir, 'final.json'), JSON.stringify(finalJson, null, 2));
    
    // Update run status
    run.status = 'completed';
    saveCurrentRun(run);
    
    spinner.succeed(chalk.green('Verdict generated'));
    
    if (!options.json) {
      console.log('\n' + chalk.bold('═'.repeat(50)));
      if (verdict === 'PASS') {
        console.log(chalk.bold(`  VERDICT: ${chalk.green(verdict)}`));
      } else {
        console.log(chalk.bold(`  VERDICT: ${chalk.red(verdict)}`));
      }
      console.log(chalk.bold('═'.repeat(50)));
      console.log(chalk.gray(`\n  P0 (Blocking): ${aggregated.p0Total}`));
      console.log(chalk.gray(`  P1 (Important): ${aggregated.p1Total}`));
      console.log(chalk.gray(`  P2 (Minor): ${aggregated.p2Total}`));
      console.log(chalk.gray(`  Reports: ${completionStatus.completed}/${completionStatus.total}`));
      console.log(chalk.gray(`\n  Output: _ctx/review_runs/${run.run_id}/final.md`));
      
      if (verdict === 'PASS') {
        console.log(chalk.gray('\n  Next: reviewctl merge'));
      } else {
        console.log(chalk.yellow('\n  Next: Fix P0 issues and re-run review'));
      }
    } else {
      console.log(JSON.stringify(finalJson, null, 2));
    }
    
    // Exit code 0 for PASS, 1 for FAIL
    process.exit(verdict === 'PASS' ? 0 : 1);
    
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate verdict'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

interface CompletionStatus {
  required: string[];
  completed: number;
  total: number;
  missing: string[];
  invalid: string[];
  invalidDetails: Record<string, string[]>;
}

interface PlanJson {
  required_agents: string[];
  optional_agents: string[];
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

function checkCompletionStatus(runDir: string, reportsDir: string, tasksDir: string): CompletionStatus {
  const planJson = loadPlanJson(runDir);

  // Source of truth: plan.json required agents; fallback to REQUEST files.
  const requiredAgents = planJson?.required_agents?.length
    ? planJson.required_agents
    : fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith('REQUEST_') && f.endsWith('.md') && !f.includes('statics'))
        .map((f) => f.replace('REQUEST_', '').replace('.md', ''));

  const missing: string[] = [];
  const invalid: string[] = [];
  const invalidDetails: Record<string, string[]> = {};
  let completed = 0;

  for (const agent of requiredAgents) {
    const reportPath = path.join(reportsDir, `reviewer_${agent}.md`);
    const statusPath = path.join(tasksDir, agent, 'status.json');

    const hasReport = fs.existsSync(reportPath);
    const statusPathExists = fs.existsSync(statusPath);

    if (!hasReport && !statusPathExists) {
      missing.push(agent);
      continue;
    }

    if (statusPathExists) {
      try {
        const statusJson = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));

        if (statusJson.status === 'DONE' && statusJson.validation?.valid) {
          completed++;
        } else if (statusJson.status === 'INVALID' || (statusJson.validation && !statusJson.validation.valid)) {
          invalid.push(agent);
          invalidDetails[agent] = statusJson.validation?.errors || ['Contract validation failed'];
        } else {
          missing.push(agent);
        }
      } catch {
        missing.push(agent);
      }
    } else {
      missing.push(agent);
    }
  }

  return {
    required: requiredAgents,
    completed,
    total: requiredAgents.length,
    missing,
    invalid,
    invalidDetails
  };
}

interface AggregatedResults {
  p0Total: number;
  p1Total: number;
  p2Total: number;
  agents: Record<string, { p0: number; p1: number; p2: number; status: string }>;
  statics: Record<string, { issues: number; status: string }>;
  topP0Findings: any[];
  topP1Findings: any[];
}

function aggregateReports(
  reportsDir: string,
  tasksDir: string,
  staticsDir: string,
  run: any
): AggregatedResults {
  const result: AggregatedResults = {
    p0Total: 0,
    p1Total: 0,
    p2Total: 0,
    agents: {},
    statics: {},
    topP0Findings: [],
    topP1Findings: []
  };
  
  // Aggregate agent results
  const taskDirs = fs.readdirSync(tasksDir).filter(f => {
    const stat = fs.statSync(path.join(tasksDir, f));
    return stat.isDirectory();
  });
  
  for (const agent of taskDirs) {
    const resultPath = path.join(tasksDir, agent, 'result.json');
    const statusPath = path.join(tasksDir, agent, 'status.json');
    
    // Check status
    let agentStatus = 'pending';
    if (fs.existsSync(statusPath)) {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      agentStatus = status.status || 'pending';
    }
    
    if (fs.existsSync(resultPath) && agentStatus === 'DONE') {
      try {
        const agentResult = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
        const stats = agentResult.statistics || { p0_count: 0, p1_count: 0, p2_count: 0 };
        
        result.agents[agent] = {
          p0: stats.p0_count,
          p1: stats.p1_count,
          p2: stats.p2_count,
          status: 'done'
        };
        
        result.p0Total += stats.p0_count;
        result.p1Total += stats.p1_count;
        result.p2Total += stats.p2_count;
        
        // Collect P0/P1 findings
        if (agentResult.findings) {
          for (const finding of agentResult.findings) {
            if (finding.priority === 'P0') {
              result.topP0Findings.push({ ...finding, agent });
            } else if (finding.priority === 'P1') {
              result.topP1Findings.push({ ...finding, agent });
            }
          }
        }
      } catch (e) {
        result.agents[agent] = { p0: 0, p1: 0, p2: 0, status: 'error' };
      }
    } else {
      result.agents[agent] = { p0: 0, p1: 0, p2: 0, status: agentStatus };
    }
  }
  
  // Aggregate static analysis
  if (fs.existsSync(staticsDir)) {
    const statusFiles = fs.readdirSync(staticsDir).filter(f => f.endsWith('_status.json'));
    for (const file of statusFiles) {
      const toolName = file.replace('_status.json', '');
      const statusPath = path.join(staticsDir, file);
      const reportPath = path.join(staticsDir, `${toolName}.md`);
      
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        
        let issues = 0;
        if (fs.existsSync(reportPath)) {
          const content = fs.readFileSync(reportPath, 'utf-8');
          issues = (content.match(/error|warning|Error|Warning/g) || []).length;
        }
        
        result.statics[toolName] = { 
          issues, 
          status: status.status || 'unknown'
        };
      } catch (e) {
        result.statics[toolName] = { issues: 0, status: 'error' };
      }
    }
  }
  
  return result;
}

function determineVerdict(aggregated: AggregatedResults): Verdict {
  // FAIL if any P0 findings
  return aggregated.p0Total > 0 ? 'FAIL' : 'PASS';
}

function generateFinalMd(
  aggregated: AggregatedResults,
  verdict: Verdict,
  run: any,
  completionStatus: CompletionStatus
): string {
  const timestamp = new Date().toISOString();
  const diffStats = getDiffStats();
  
  let md = `# Final Review Report

## Run Information
- **Run ID**: ${run.run_id}
- **Branch**: ${run.branch}
- **Base Branch**: ${run.base_branch}
- **Plan Source**: ${run.plan_path || 'N/A'}
- **Generated**: ${timestamp}

## Executive Summary

${verdict === 'PASS' ? 
  'The review completed successfully with no blocking issues. The changes are ready for merge.' :
  'The review found critical issues that must be addressed before merge. Please review P0 findings below.'}

---

## Verdict

# **${verdict === 'PASS' ? 'PASS' : 'FAIL'}**

### Rationale
${verdict === 'PASS' ?
  `No P0 (blocking) issues found. ${aggregated.p1Total} P1 and ${aggregated.p2Total} P2 issues were identified for follow-up.` :
  `${aggregated.p0Total} P0 (blocking) issue(s) found. These must be resolved before merge.`}

---

## Completion Status

| Metric | Value |
|--------|-------|
| Required Agents | ${completionStatus.total} |
| Completed | ${completionStatus.completed} |
| Missing | ${completionStatus.missing.length > 0 ? completionStatus.missing.join(', ') : 'None'} |

---

## Statistics

### By Priority
| Priority | Count | Blocking |
|----------|-------|----------|
| P0 | ${aggregated.p0Total} | Yes |
| P1 | ${aggregated.p1Total} | No |
| P2 | ${aggregated.p2Total} | No |

### By Agent
| Agent | P0 | P1 | P2 | Status |
|-------|----|----|----|----|
`;

  for (const [agent, stats] of Object.entries(aggregated.agents)) {
    const statusIcon = stats.status === 'done' ? '✓' : 
                       stats.status === 'pending' ? '⏳' : 
                       stats.status === 'error' ? '✗' : '?';
    md += `| ${agent} | ${stats.p0} | ${stats.p1} | ${stats.p2} | ${statusIcon} |\n`;
  }

  md += `
### Static Analysis
| Tool | Issues | Status |
|------|--------|--------|
`;

  for (const [tool, stats] of Object.entries(aggregated.statics)) {
    md += `| ${tool} | ${stats.issues} | ${stats.status} |\n`;
  }

  // P0 Findings
  if (aggregated.topP0Findings.length > 0) {
    md += `
---

## Critical Issues (P0)

`;
    for (let i = 0; i < aggregated.topP0Findings.length; i++) {
      const finding = aggregated.topP0Findings[i];
      md += `### P0-${i + 1}: ${finding.title} (from ${finding.agent})
- **Location**: \`${finding.location?.file || 'Unknown'}${finding.location?.line_start ? ':' + finding.location.line_start : ''}\`
- **Description**: ${finding.description}
- **Fix**: ${finding.fix_suggestion || 'Review and fix'}

`;
    }
  }

  // P1 Findings (top 5)
  if (aggregated.topP1Findings.length > 0) {
    md += `---
  
## Important Issues (P1)

`;
    const topP1 = aggregated.topP1Findings.slice(0, 5);
    for (let i = 0; i < topP1.length; i++) {
      const finding = topP1[i];
      md += `### P1-${i + 1}: ${finding.title} (from ${finding.agent})
- **Location**: \`${finding.location?.file || 'Unknown'}${finding.location?.line_start ? ':' + finding.location.line_start : ''}\`
- **Description**: ${finding.description}
- **Fix**: ${finding.fix_suggestion || 'Review and improve'}

`;
    }
    
    if (aggregated.topP1Findings.length > 5) {
      md += `_... and ${aggregated.topP1Findings.length - 5} more P1 issues. See individual reports for details._\n`;
    }
  }

  // P2 summary
  md += `
---

## Minor Issues (P2)

Total P2 issues: ${aggregated.p2Total}. See individual reports for details.

---

## Drift Analysis

- **Status**: ${run.drift_status || 'UNKNOWN'}
- **Plan Match**: ${run.plan_status === 'FOUND' ? 'Verified against plan' : 'No plan available'}
- **Deviations**: ${run.drift_status === 'ALIGNED' ? 'None detected' : 'Review required'}

---

## Recommended Actions

### Before Merge (Required)
${verdict === 'FAIL' ? 
  aggregated.topP0Findings.map((f, i) => `${i + 1}. Fix P0-${i + 1}: ${f.title}`).join('\n') :
  '1. No blocking issues - ready for merge'}

### Post-Merge (Recommended)
${aggregated.p1Total > 0 ? `1. Review and address P1 issues (${aggregated.p1Total} total)` : '1. No P1 issues to address'}
${aggregated.p2Total > 0 ? `2. Consider addressing P2 issues (${aggregated.p2Total} total)` : '2. No P2 issues to address'}

---

## Artifacts

| Artifact | Path |
|----------|------|
| Context | \`explore/context.md\` |
| Diff | \`explore/diff.md\` |
| Reviewer Reports | \`_ctx/review_runs/${run.run_id}/reports/\` |
| Static Analysis | \`_ctx/review_runs/${run.run_id}/statics/\` |
| Final JSON | \`_ctx/review_runs/${run.run_id}/final.json\` |

---

## Review Metadata

- **Plan Used**: ${run.plan_path || 'None'}
- **Agents Completed**: ${completionStatus.completed}/${completionStatus.total}
- **Static Tools**: ${Object.keys(aggregated.statics).join(', ') || 'None'}

---

_Generated by reviewctl v1.0 - Handoff Generator_
`;

  return md;
}

function generateFinalJson(
  aggregated: AggregatedResults,
  verdict: Verdict,
  run: any,
  completionStatus: CompletionStatus
): FinalResult {
  const diffStats = getDiffStats();
  
  return {
    run_id: run.run_id,
    branch: run.branch,
    base_branch: run.base_branch,
    timestamp: new Date().toISOString(),
    verdict,
    statistics: {
      p0_total: aggregated.p0Total,
      p1_total: aggregated.p1Total,
      p2_total: aggregated.p2Total,
      files_changed: diffStats.files,
      lines_added: diffStats.added,
      lines_removed: diffStats.removed
    },
    agents: aggregated.agents,
    statics: aggregated.statics,
    drift: {
      status: run.drift_status || 'UNKNOWN',
      plan_source: run.plan_path || null
    },
    artifacts: {
      context: 'explore/context.md',
      diff: 'explore/diff.md',
      reports: Object.keys(aggregated.agents).map(a => `_ctx/review_runs/${run.run_id}/reports/reviewer_${a}.md`),
      final_json: `_ctx/review_runs/${run.run_id}/final.json`
    }
  } as any; // Type assertion to allow additional fields
}
