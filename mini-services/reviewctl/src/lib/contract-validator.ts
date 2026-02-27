import crypto from 'node:crypto';
import path from 'node:path';

// Contract validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  lineCount: number;
  sections: {
    summary: boolean;
    findings_p0: boolean;
    findings_p1: boolean;
    findings_p2: boolean;
    test_plan: boolean;
    confidence: boolean;
    verdict: boolean;
  };
  statistics: {
    p0_count: number;
    p1_count: number;
    p2_count: number;
  };
}

// Maximum allowed lines in a report
const MAX_REPORT_LINES = 120;

// Required section patterns
const REQUIRED_SECTIONS = {
  summary: /^##\s*Summary/im,
  findings_p0: /^###?\s*P0|####?\s*P0-/im,
  findings_p1: /^###?\s*P1|####?\s*P1-/im,
  findings_p2: /^###?\s*P2|####?\s*P2-/im,
  test_plan: /^##\s*(Test\s*Plan|Tests?)/im,
  confidence: /^##\s*Confidence|Confidence:\s*\d/im,
  verdict: /^##\s*Verdict/im,
};

// Evidence pattern: file:line or file(line) or `file:line`
const EVIDENCE_PATTERN =
  /(?:`([^`]+:\d+)`|([a-zA-Z0-9_\-./]+\.\w+:\d+)|\*\*Location\*\*[^\n]*(\S+:\d+))/gi;

// Validate report against SSOT contract
export function validateReport(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sections = {
    summary: false,
    findings_p0: false,
    findings_p1: false,
    findings_p2: false,
    test_plan: false,
    confidence: false,
    verdict: false,
  };

  // Check line count
  const lines = content.split('\n');
  const lineCount = lines.length;

  if (lineCount > MAX_REPORT_LINES) {
    errors.push(
      `Report exceeds ${MAX_REPORT_LINES} lines (actual: ${lineCount})`,
    );
  }

  // Check required sections
  for (const [section, pattern] of Object.entries(REQUIRED_SECTIONS)) {
    if (pattern.test(content)) {
      sections[section as keyof typeof sections] = true;
    }
  }

  // Allow flexibility: P0/P1/P2 sections are required, but can be empty
  // Only warn if section header missing entirely
  if (!sections.summary) {
    errors.push('Missing required section: Summary');
  }

  // P0/P1/P2 - we accept either section headers OR individual findings
  const hasFindings =
    sections.findings_p0 || sections.findings_p1 || sections.findings_p2;
  if (!hasFindings) {
    // Check if report explicitly states "No findings"
    const noFindingsPattern =
      /no\s+(P0|P1|P2|critical|blocking|findings?|issues?)/i;
    const hasNoFindings = noFindingsPattern.test(content);
    if (!hasNoFindings) {
      warnings.push(
        'No findings sections found (P0/P1/P2). If intentional, state "No findings" explicitly.',
      );
    }
  }

  if (!sections.verdict) {
    errors.push('Missing required section: Verdict');
  }

  // Test Plan and Confidence are recommended but not blocking
  if (!sections.test_plan) {
    warnings.push('Missing recommended section: Test Plan');
  }
  if (!sections.confidence) {
    warnings.push('Missing recommended section: Confidence');
  }

  // Extract findings and validate evidence
  const statistics = extractStatistics(content);

  // Check findings have evidence
  const findingsWithoutEvidence = checkFindingsEvidence(content);
  if (findingsWithoutEvidence.length > 0) {
    for (const finding of findingsWithoutEvidence) {
      warnings.push(
        `Finding "${finding.title}" lacks proper evidence (file:line format)`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    lineCount,
    sections,
    statistics,
  };
}

// Extract P0/P1/P2 counts from report
function extractStatistics(content: string): {
  p0_count: number;
  p1_count: number;
  p2_count: number;
} {
  // Match finding headers like "#### P0-1:", "### P0-1", "Finding P0-1"
  const p0Matches = content.match(/(?:####?\s*|Finding\s+)P0[-\d]/gi);
  const p1Matches = content.match(/(?:####?\s*|Finding\s+)P1[-\d]/gi);
  const p2Matches = content.match(/(?:####?\s*|Finding\s+)P2[-\d]/gi);

  // Also check for count in Statistics table
  const p0TableMatch = content.match(/\|\s*P0\s*\|\s*(\d+)\s*\|/);
  const p1TableMatch = content.match(/\|\s*P1\s*\|\s*(\d+)\s*\|/);
  const p2TableMatch = content.match(/\|\s*P2\s*\|\s*(\d+)\s*\|/);

  return {
    p0_count: p0TableMatch
      ? parseInt(p0TableMatch[1], 10)
      : p0Matches?.length || 0,
    p1_count: p1TableMatch
      ? parseInt(p1TableMatch[1], 10)
      : p1Matches?.length || 0,
    p2_count: p2TableMatch
      ? parseInt(p2TableMatch[1], 10)
      : p2Matches?.length || 0,
  };
}

// Check findings have evidence
interface FindingInfo {
  id: string;
  title: string;
  hasEvidence: boolean;
}

function checkFindingsEvidence(content: string): FindingInfo[] {
  const findingsWithoutEvidence: FindingInfo[] = [];

  // Pattern to find finding sections
  const findingPattern = /(?:####?\s*(P[012]-\d+)[\s:]+([^\n]+))/gi;
  let match: RegExpExecArray | null = findingPattern.exec(content);

  while (match !== null) {
    const id = match[1];
    const title = match[2].trim();

    // Get the content after this heading until next heading or end
    const startIndex = match.index + match[0].length;
    const nextHeading = content.indexOf('####', startIndex);
    const nextSection = content.indexOf('##', startIndex);
    const endIndex =
      nextHeading > 0
        ? Math.min(nextHeading, nextSection > 0 ? nextSection : content.length)
        : nextSection > 0
          ? nextSection
          : content.length;

    const findingContent = content.substring(startIndex, endIndex);

    // Check for evidence
    const hasEvidence =
      EVIDENCE_PATTERN.test(findingContent) ||
      /\*\*Location\*\*/i.test(findingContent) ||
      /\*\*Evidence\*\*/i.test(findingContent) ||
      /```/.test(findingContent);

    if (!hasEvidence) {
      findingsWithoutEvidence.push({ id, title, hasEvidence: false });
    }

    // Reset regex lastIndex and get next match
    EVIDENCE_PATTERN.lastIndex = 0;
    match = findingPattern.exec(content);
  }

  return findingsWithoutEvidence;
}

// Compute hash of content
export function computeHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

// Sanitize name (agent/tool) - only allow [a-z0-9-]+
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 50);
}

// Validate name format
export function isValidName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name) && name.length <= 50;
}

// Check for path traversal
export function hasPathTraversal(pathStr: string): boolean {
  const normalized = path.normalize(pathStr);
  return normalized.includes('..') || path.isAbsolute(pathStr);
}
