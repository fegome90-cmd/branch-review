import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { glob } from 'glob';
import {
  EXPLORE_DIR,
  REVIEW_RUNS_DIR
} from '../lib/constants.js';
import {
  ensureDir,
  getCurrentRun,
  getCurrentBranch,
  getBaseBranch,
  getDiffStats,
  getChangedFiles,
  copyExplorerFiles
} from '../lib/utils.js';
import {
  detectStack,
  detectSensitiveZones,
  determineThirdAgent,
  StackInfo,
  SensitiveZone
} from '../lib/stack-detector.js';
import { resolvePlan } from '../lib/plan-resolver.js';

export async function exploreCommand(type: string, options: { force?: boolean }) {
  const validTypes = ['context', 'diff'];
  if (!validTypes.includes(type)) {
    console.error(chalk.red(`Invalid explorer type: ${type}`));
    console.log(chalk.gray(`  Valid types: ${validTypes.join(', ')}`));
    process.exit(1);
  }
  
  const spinner = ora(`Running ${type} explorer...`).start();
  
  try {
    ensureDir(EXPLORE_DIR);
    
    const run = getCurrentRun();
    if (!run) {
      spinner.fail('No active review run. Run: reviewctl init');
      process.exit(1);
    }
    
    if (type === 'context') {
      await runContextExplorer(spinner, options.force);
    } else {
      await runDiffExplorer(spinner, options.force);
    }
    
    // Copy to run directory
    copyExplorerFiles(run.run_id);
    
    spinner.succeed(chalk.green(`Explorer ${type} completed`));
    
    if (type === 'context') {
      console.log(chalk.gray(`  Output: explore/context.md`));
      console.log(chalk.gray(`  Next: reviewctl explore diff`));
    } else {
      console.log(chalk.gray(`  Output: explore/diff.md`));
      console.log(chalk.gray(`  Next: reviewctl plan`));
    }
    
  } catch (error) {
    spinner.fail(chalk.red(`Explorer ${type} failed`));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function runContextExplorer(spinner: any, force?: boolean) {
  const outputPath = path.join(EXPLORE_DIR, 'context.md');
  
  if (fs.existsSync(outputPath) && !force) {
    spinner.text = 'context.md exists, use --force to re-run';
    return;
  }
  
  spinner.text = 'Detecting stack...';
  const stack = await detectStack();
  
  spinner.text = 'Analyzing changed files...';
  const changedFiles = getChangedFiles();
  const sensitiveZones = detectSensitiveZones(changedFiles);
  
  spinner.text = 'Determining third agent...';
  const thirdAgent = determineThirdAgent(stack, sensitiveZones);
  
  const branch = getCurrentBranch();
  const baseBranch = getBaseBranch();
  
  // Generate context.md
  const content = generateContextMd(stack, sensitiveZones, thirdAgent, changedFiles, branch, baseBranch);
  fs.writeFileSync(outputPath, content);
}

function generateContextMd(
  stack: StackInfo,
  zones: SensitiveZone[],
  thirdAgent: string,
  changedFiles: string[],
  branch: string,
  baseBranch: string
): string {
  const timestamp = new Date().toISOString();
  
  let md = `# Context Analysis

## Run Information
- **Run ID**: ${getCurrentRun()?.run_id || 'unknown'}
- **Branch**: ${branch}
- **Base Branch**: ${baseBranch}
- **Generated**: ${timestamp}

## Stack Detection

### Primary Stack
- **Languages**: ${stack.languages.join(', ') || 'None detected'}
- **Frameworks**: ${stack.frameworks.join(', ') || 'None detected'}
- **Runtimes**: ${stack.runtimes.join(', ') || 'None detected'}

### Secondary Components
- **Databases**: ${stack.databases.join(', ') || 'None detected'}
- **Services**: ${stack.services.join(', ') || 'None detected'}
- **Build Tools**: ${stack.buildTools.join(', ') || 'None detected'}

## Sensitive Zones Touched

| Zone | Files | Risk Level |
|------|-------|------------|
`;

  if (zones.length > 0) {
    for (const zone of zones) {
      md += `| ${zone.zone} | ${zone.files.slice(0, 3).join(', ')}${zone.files.length > 3 ? '...' : ''} | ${zone.riskLevel} |\n`;
    }
  } else {
    md += `| None detected | - | - |\n`;
  }

  md += `
## Relevant Commands

### Build/Test
\`\`\`bash
bun run dev
bun run lint
\`\`\`

### Database
\`\`\`bash
bun run db:push
bun run db:generate
\`\`\`

## Obvious Risks
`;

  const risks = generateRiskBullets(zones, stack);
  for (let i = 0; i < Math.min(risks.length, 5); i++) {
    md += `${i + 1}. ${risks[i]}\n`;
  }
  
  md += `
## Recommended Agents

Based on detected stack:
- **Always**: code-reviewer, code-simplifier
- **Third**: ${thirdAgent}

## Recommended Static Tools

`;

  const tools = getStaticTools(stack);
  for (const tool of tools) {
    md += `- ${tool.name}: ${tool.reason}\n`;
  }

  return md;
}

function generateRiskBullets(zones: SensitiveZone[], stack: StackInfo): string[] {
  const risks: string[] = [];
  
  for (const zone of zones) {
    if (zone.riskLevel === 'HIGH') {
      if (zone.zone === 'Authentication') {
        risks.push('Authentication changes may affect security - careful review required');
      } else if (zone.zone === 'Database/Schema') {
        risks.push('Schema changes may require migrations - check for data loss scenarios');
      } else if (zone.zone === 'Security') {
        risks.push('Security middleware modified - verify no access control bypasses');
      }
    }
  }
  
  if (stack.languages.includes('SQL')) {
    risks.push('SQL queries present - check for injection vulnerabilities');
  }
  
  if (risks.length === 0) {
    risks.push('No obvious high-risk areas detected');
  }
  
  return risks;
}

function getStaticTools(stack: StackInfo): Array<{ name: string; reason: string }> {
  const tools: Array<{ name: string; reason: string }> = [];
  
  if (stack.languages.includes('Python')) {
    tools.push({ name: 'ruff', reason: 'Python linter and formatter' });
    tools.push({ name: 'pyrefly', reason: 'Python type checker' });
  }
  
  if (stack.languages.includes('TypeScript') || stack.languages.includes('JavaScript')) {
    tools.push({ name: 'biome', reason: 'JS/TS linter and formatter' });
  }
  
  tools.push({ name: 'coderabbit', reason: 'AI external review (optional)' });
  
  return tools;
}

async function runDiffExplorer(spinner: any, force?: boolean) {
  const outputPath = path.join(EXPLORE_DIR, 'diff.md');
  
  if (fs.existsSync(outputPath) && !force) {
    spinner.text = 'diff.md exists, use --force to re-run';
    return;
  }
  
  spinner.text = 'Analyzing diff stats...';
  const diffStats = getDiffStats();
  const changedFiles = getChangedFiles();
  
  spinner.text = 'Resolving plan...';
  const planResult = await resolvePlan();
  
  spinner.text = 'Generating diff analysis...';
  const branch = getCurrentBranch();
  const baseBranch = getBaseBranch();
  
  const content = generateDiffMd(diffStats, changedFiles, planResult, branch, baseBranch);
  fs.writeFileSync(outputPath, content);
  
  // Update run metadata with drift status
  const run = getCurrentRun();
  if (run) {
    const driftStatus = parseDriftStatus(content);
    run.drift_status = driftStatus;
    
    const runDir = path.join(REVIEW_RUNS_DIR, run.run_id);
    fs.writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify(run, null, 2)
    );
  }
}

function generateDiffMd(
  diffStats: { files: number; added: number; removed: number },
  changedFiles: string[],
  planResult: { status: string; path: string | null; candidates?: any[] },
  branch: string,
  baseBranch: string
): string {
  const timestamp = new Date().toISOString();
  const run = getCurrentRun();
  
  let md = `# Diff Analysis

## Run Information
- **Run ID**: ${run?.run_id || 'unknown'}
- **Branch**: ${branch}
- **Base Branch**: ${baseBranch}
- **Generated**: ${timestamp}

## Diffstat Summary

| Metric | Value |
|--------|-------|
| Files Changed | ${diffStats.files} |
| Lines Added | ${diffStats.added} |
| Lines Removed | ${diffStats.removed} |
| Net Change | ${diffStats.added - diffStats.removed > 0 ? '+' : ''}${diffStats.added - diffStats.removed} |

### Top Changed Files

| File | Changes |
|------|---------|
`;

  // Group by directory
  const dirCounts = new Map<string, number>();
  for (const file of changedFiles) {
    const dir = path.dirname(file);
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }
  
  const topDirs = Array.from(dirCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  for (const [dir, count] of topDirs) {
    md += `| ${dir || '/'} | ${count} files |\n`;
  }

  md += `
## Hotspots

Files with high concentration of changes:
`;

  // Identify hotspots (files in sensitive areas)
  const hotspots = changedFiles.filter(f => 
    /auth|api|db|schema|migration|config/i.test(f)
  ).slice(0, 3);
  
  if (hotspots.length > 0) {
    for (const file of hotspots) {
      md += `1. \`${file}\`: Sensitive area touched\n`;
    }
  } else {
    md += `1. No obvious hotspots detected\n`;
  }

  md += `
---

## Plan vs Implementation (Anti-Drift)

### Plan Source
- **Status**: ${planResult.status}
`;

  if (planResult.status === 'FOUND') {
    md += `- **Path**: ${planResult.path}\n`;
  } else if (planResult.status === 'AMBIGUOUS' && planResult.candidates) {
    md += `- **Candidates**:\n`;
    for (const c of planResult.candidates) {
      md += `  - ${c.path} (score: ${c.score})\n`;
    }
  }

  md += `
### Plan Digest
`;

  if (planResult.status === 'FOUND' && planResult.path) {
    // Try to extract plan items
    md += `- Plan found at ${planResult.path}\n`;
    md += `- Review plan document for implementation details\n`;
  } else {
    md += `- No plan available for comparison\n`;
    md += `- Implementation review only\n`;
  }

  md += `
### Implementation Digest
`;

  // Summarize implementation from changed files
  const categories = categorizeChanges(changedFiles);
  for (const cat of Object.keys(categories).slice(0, 6)) {
    md += `- ${cat}: ${categories[cat]} changes\n`;
  }

  md += `
### Drift Checklist

| Check | Status | Evidence |
|-------|--------|----------|
| All planned features implemented? | UNKNOWN | No plan to compare |
| No extra features added? | UNKNOWN | No plan to compare |
| API contracts preserved? | ${changedFiles.some(f => /api|route/i.test(f)) ? 'UNKNOWN' : 'PASS'} | ${changedFiles.some(f => /api|route/i.test(f)) ? 'API files changed' : 'No API files changed'} |
| Database schema matches plan? | ${changedFiles.some(f => /schema|migration/i.test(f)) ? 'UNKNOWN' : 'PASS'} | ${changedFiles.some(f => /schema|migration/i.test(f)) ? 'Schema/migration files changed' : 'No schema changes'} |
| Configuration as planned? | ${changedFiles.some(f => /config|env/i.test(f)) ? 'UNKNOWN' : 'PASS'} | ${changedFiles.some(f => /config|env/i.test(f)) ? 'Config files changed' : 'No config changes'} |
| Test coverage as planned? | ${changedFiles.some(f => /test|spec/i.test(f)) ? 'PASS' : 'UNKNOWN'} | ${changedFiles.some(f => /test|spec/i.test(f)) ? 'Tests present' : 'No test files changed'} |

### Drift Verdict
**${planResult.status === 'MISSING' || planResult.status === 'AMBIGUOUS' ? 'DRIFT_RISK' : 'ALIGNED'}**

${planResult.status === 'MISSING' ? 'No plan available for drift comparison' : planResult.status === 'AMBIGUOUS' ? 'Multiple plan candidates found, cannot determine alignment' : 'Implementation appears aligned with plan'}

---

## Gate Status

| Gate | Status | Action Required |
|------|--------|-----------------|
| Context Available | ${fs.existsSync(path.join(process.cwd(), 'explore/context.md')) ? '✓' : '✗'} | ${fs.existsSync(path.join(process.cwd(), 'explore/context.md')) ? 'None' : 'Run: reviewctl explore context'} |
| Diff Available | ✓ | None |
| Plan Resolved | ${planResult.status === 'FOUND' ? '✓' : '✗'} | ${planResult.status === 'FOUND' ? 'None' : 'Provide plan path'} |
| Drift Acceptable | ${planResult.status !== 'DRIFT_CONFIRMED' ? '✓' : '✗'} | ${planResult.status !== 'DRIFT_CONFIRMED' ? 'None' : 'Resolve drift'} |

**Ready for Planning**: ${planResult.status === 'FOUND' ? 'YES' : 'NO'} - ${planResult.status === 'FOUND' ? 'All gates passed' : 'Resolve plan status first'}
`;

  return md;
}

function categorizeChanges(files: string[]): Record<string, number> {
  const categories: Record<string, number> = {};
  
  for (const file of files) {
    let category = 'Other';
    
    if (/api|route/i.test(file)) category = 'API';
    else if (/component|page/i.test(file)) category = 'UI Components';
    else if (/hook|util|lib/i.test(file)) category = 'Utilities';
    else if (/test|spec/i.test(file)) category = 'Tests';
    else if (/db|schema|migration/i.test(file)) category = 'Database';
    else if (/config|env/i.test(file)) category = 'Configuration';
    else if (/style|css/i.test(file)) category = 'Styling';
    else if (/type|interface/i.test(file)) category = 'Types';
    
    categories[category] = (categories[category] || 0) + 1;
  }
  
  return categories;
}

function parseDriftStatus(content: string): 'ALIGNED' | 'DRIFT_RISK' | 'DRIFT_CONFIRMED' {
  if (content.includes('DRIFT_CONFIRMED')) return 'DRIFT_CONFIRMED';
  if (content.includes('DRIFT_RISK')) return 'DRIFT_RISK';
  return 'ALIGNED';
}
