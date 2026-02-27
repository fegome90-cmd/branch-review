import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import {
  CLAUDE_PLANS_DIR,
  DOCS_DIR,
  PLANS_DIR,
  type PlanStatus,
} from './constants.js';
import { getBaseBranch, getCurrentBranch, getCurrentSha } from './utils.js';

interface PlanCandidate {
  path: string;
  score: number;
  reason: string;
}

// Plan SSOT resolver - deterministic order
export async function resolvePlan(): Promise<{
  status: PlanStatus;
  path: string | null;
  candidates?: PlanCandidate[];
}> {
  const candidates: PlanCandidate[] = [];
  const branch = getCurrentBranch();
  const _baseBranch = getBaseBranch();
  const _sha = getCurrentSha();

  // Extract identifiers from branch name
  const branchIdentifiers = extractIdentifiers(branch);

  // 1. Check docs/plans/**
  const docsPlansPath = path.join(PLANS_DIR);
  if (fs.existsSync(docsPlansPath)) {
    const files = await glob('**/*.md', { cwd: docsPlansPath });
    for (const file of files) {
      const score = scorePlan(file, branchIdentifiers);
      candidates.push({
        path: path.join(docsPlansPath, file),
        score,
        reason: 'docs/plans match',
      });
    }
  }

  // 2. Check docs/plan/**
  const docsPlanPath = path.join(DOCS_DIR, 'plan');
  if (fs.existsSync(docsPlanPath)) {
    const files = await glob('**/*.md', { cwd: docsPlanPath });
    for (const file of files) {
      const score = scorePlan(file, branchIdentifiers);
      candidates.push({
        path: path.join(docsPlanPath, file),
        score,
        reason: 'docs/plan match',
      });
    }
  }

  // 3. Check docs/** for strong matches
  if (fs.existsSync(DOCS_DIR)) {
    const files = await glob('**/*.md', {
      cwd: DOCS_DIR,
      ignore: ['plans/**', 'plan/**'],
    });
    for (const file of files) {
      const score = scorePlan(file, branchIdentifiers);
      if (score >= 50) {
        // Strong match threshold
        candidates.push({
          path: path.join(DOCS_DIR, file),
          score,
          reason: 'docs strong match',
        });
      }
    }
  }

  // 4. Check .claude/plans/** with allowlist
  const allowlistPath = path.join(CLAUDE_PLANS_DIR, 'ALLOWLIST.txt');
  const allowlistJsonPath = path.join(CLAUDE_PLANS_DIR, 'plans.json');

  let allowedPlans: string[] = [];

  if (fs.existsSync(allowlistPath)) {
    allowedPlans = fs
      .readFileSync(allowlistPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } else if (fs.existsSync(allowlistJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(allowlistJsonPath, 'utf-8'));
      allowedPlans = data.plans || [];
    } catch {}
  }

  if (fs.existsSync(CLAUDE_PLANS_DIR) && allowedPlans.length > 0) {
    for (const allowed of allowedPlans) {
      const fullPath = path.join(CLAUDE_PLANS_DIR, allowed);
      if (fs.existsSync(fullPath)) {
        const score = scorePlan(allowed, branchIdentifiers) + 10; // Boost for allowlist
        candidates.push({
          path: fullPath,
          score,
          reason: '.claude/plans allowlist',
        });
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Determine status
  if (candidates.length === 0) {
    return { status: 'MISSING', path: null };
  }

  const topCandidate = candidates[0];
  const secondBest = candidates[1];

  // If top candidate is significantly better than second best, it's a clear match
  if (!secondBest || topCandidate.score - secondBest.score >= 20) {
    return { status: 'FOUND', path: topCandidate.path };
  }

  // Multiple close candidates = ambiguous
  return {
    status: 'AMBIGUOUS',
    path: null,
    candidates: candidates.slice(0, 5), // Return top 5 for user to choose
  };
}

// Extract identifiers from branch name
function extractIdentifiers(branch: string): string[] {
  const identifiers: string[] = [];

  // Extract from review/<base>-<sha> pattern
  const reviewMatch = branch.match(/review\/(\w+)-([a-f0-9]+)/);
  if (reviewMatch) {
    identifiers.push(reviewMatch[1]); // base branch
    identifiers.push(reviewMatch[2]); // sha
  }

  // Extract from WO-xxx, PR-xxx, JIRA-xxx patterns
  const taskMatch = branch.match(/[A-Z]+-\d+/g);
  if (taskMatch) {
    identifiers.push(...taskMatch);
  }

  // Extract kebab-case words
  const words = branch.split(/[-_/]/).filter((w) => w.length > 2);
  identifiers.push(...words);

  return identifiers;
}

// Score a plan file against identifiers
function scorePlan(filePath: string, identifiers: string[]): number {
  let score = 0;
  const fileName = path.basename(filePath, '.md').toLowerCase();
  const filePathLower = filePath.toLowerCase();

  for (const id of identifiers) {
    const idLower = id.toLowerCase();

    // Exact filename match
    if (fileName === idLower) {
      score += 100;
    }
    // Filename contains identifier
    else if (fileName.includes(idLower)) {
      score += 50;
    }
    // Path contains identifier
    else if (filePathLower.includes(idLower)) {
      score += 20;
    }
  }

  return score;
}

// Save resolved plan to run
export function savePlanRef(runId: string, planPath: string): void {
  const runDir = path.join(process.cwd(), '_ctx', 'review_runs', runId);
  const planRefPath = path.join(runDir, 'plan_ref.txt');

  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  fs.writeFileSync(planRefPath, planPath);
}
