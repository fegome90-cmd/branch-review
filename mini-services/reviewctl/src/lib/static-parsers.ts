/**
 * Static analysis output parsers for Ruff and Biome.
 * Used by ingest command and tested independently.
 */

export type StaticStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIP';

export interface StaticSummary {
  status: StaticStatus;
  reason: string;
  issues: number;
  blockingIssues?: number;
  warningIssues?: number;
}

/**
 * Read a count from content using a pattern like "Found X errors"
 */
export function readCount(content: string, pattern: RegExp): number {
  const match = content.match(pattern);
  return match ? Number(match[1]) : 0;
}

/**
 * Parse Ruff output and determine status
 */
export function parseRuffSummary(content: string): StaticSummary {
  if (/warning:\s+No Python files found/i.test(content)) {
    return {
      status: 'SKIP',
      reason: 'Ruff not applicable: no Python files found',
      issues: 0,
      blockingIssues: 0,
      warningIssues: 0,
    };
  }

  if (/All checks passed!/i.test(content)) {
    return {
      status: 'PASS',
      reason: 'Ruff reported all checks passed',
      issues: 0,
      blockingIssues: 0,
      warningIssues: 0,
    };
  }

  const errors = readCount(content, /Found\s+(\d+)\s+errors?/i);

  // Example line: src/main.py:10:5: E501 line too long
  const codeMatches = [...content.matchAll(/^[^\n:]+:\d+:\d+:\s+([A-Z]+\d+)/gm)];

  const blockingPrefixes = ['F', 'E', 'W'];
  const warnPrefixes = ['I', 'SIM', 'ARG', 'UP', 'B'];

  let blockingIssues = 0;
  let warningIssues = 0;

  for (const match of codeMatches) {
    const code = match[1] || '';
    if (blockingPrefixes.some((prefix) => code.startsWith(prefix))) {
      blockingIssues++;
      continue;
    }

    if (warnPrefixes.some((prefix) => code.startsWith(prefix))) {
      warningIssues++;
      continue;
    }

    // Unknown categories default to blocking for safety.
    blockingIssues++;
  }

  const totalIssues = errors > 0 ? errors : blockingIssues + warningIssues;

  if (blockingIssues > 0) {
    return {
      status: 'FAIL',
      reason: `Ruff blocking issues: ${blockingIssues} (warnings: ${warningIssues})`,
      issues: totalIssues > 0 ? totalIssues : blockingIssues,
      blockingIssues,
      warningIssues,
    };
  }

  if (warningIssues > 0) {
    return {
      status: 'PASS',
      reason: `Ruff warnings only: ${warningIssues} (non-blocking policy)`,
      issues: warningIssues,
      blockingIssues,
      warningIssues,
    };
  }

  if (content.trim().length === 0) {
    return {
      status: 'PASS',
      reason: 'Ruff output is empty (no findings reported)',
      issues: 0,
      blockingIssues: 0,
      warningIssues: 0,
    };
  }

  if (errors > 0) {
    return {
      status: 'FAIL',
      reason: `Ruff reported ${errors} issue(s)`,
      issues: errors,
      blockingIssues: errors,
      warningIssues: 0,
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'Could not determine Ruff result conclusively',
    issues: errors,
    blockingIssues,
    warningIssues,
  };
}

/**
 * Parse Biome output and determine status
 */
export function parseBiomeSummary(content: string): StaticSummary {
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

  if (/found\s+0\s+errors?/i.test(content) || /checked\s+\d+\s+files/i.test(content)) {
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
