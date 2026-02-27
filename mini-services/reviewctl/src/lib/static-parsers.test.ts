import { describe, expect, test } from 'bun:test';

// Helper functions extracted from ingest.ts for testing
// These mirror the parsing logic in the actual ingest command

function readCount(content: string, pattern: RegExp): number {
  const match = content.match(pattern);
  return match ? Number(match[1]) : 0;
}

function parseRuffSummary(content: string): {
  status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIP';
  reason: string;
  issues: number;
} {
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

function parseBiomeSummary(content: string): {
  status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIP';
  reason: string;
  issues: number;
} {
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

describe('parseRuffSummary', () => {
  test('returns SKIP when no Python files found', () => {
    const result = parseRuffSummary('warning: No Python files found');
    expect(result.status).toBe('SKIP');
    expect(result.issues).toBe(0);
  });

  test('returns PASS when all checks passed', () => {
    const result = parseRuffSummary('All checks passed!');
    expect(result.status).toBe('PASS');
    expect(result.issues).toBe(0);
  });

  test('returns PASS when output is empty', () => {
    const result = parseRuffSummary('');
    expect(result.status).toBe('PASS');
    expect(result.issues).toBe(0);
  });

  test('returns FAIL when errors are found', () => {
    const result = parseRuffSummary('Found 3 errors');
    expect(result.status).toBe('FAIL');
    expect(result.issues).toBe(3);
  });

  test('returns FAIL when rule findings are present', () => {
    const result = parseRuffSummary('src/main.py:10:5: E501 line too long');
    expect(result.status).toBe('FAIL');
    expect(result.issues).toBe(1);
  });

  test('returns UNKNOWN for ambiguous output', () => {
    const result = parseRuffSummary('Some random output');
    expect(result.status).toBe('UNKNOWN');
  });
});

describe('parseBiomeSummary', () => {
  test('returns PASS when output is empty', () => {
    const result = parseBiomeSummary('');
    expect(result.status).toBe('PASS');
    expect(result.issues).toBe(0);
  });

  test('returns SKIP when no files processed', () => {
    const result = parseBiomeSummary('No files were processed');
    expect(result.status).toBe('SKIP');
    expect(result.issues).toBe(0);
  });

  test('returns FAIL when errors found', () => {
    const result = parseBiomeSummary('Found 2 errors');
    expect(result.status).toBe('FAIL');
    expect(result.issues).toBe(2);
  });

  test('returns PASS when 0 errors', () => {
    const result = parseBiomeSummary('Found 0 errors. Checked 10 files');
    expect(result.status).toBe('PASS');
    expect(result.issues).toBe(0);
  });

  test('counts warnings as issues when errors present', () => {
    const result = parseBiomeSummary('Found 1 errors. Found 3 warnings.');
    expect(result.status).toBe('FAIL');
    expect(result.issues).toBe(4);
  });
});
