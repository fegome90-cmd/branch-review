import { describe, expect, it } from 'bun:test';
import { parseDeclaredVerdict, validateReport } from './contract-validator.js';

describe('explicit verdict parsing', () => {
  const cases = [
    ['bold FAIL', '## Verdict\n**FAIL** - Blocking problem', 'FAIL'],
    ['plain FAIL', '## Verdict\nFAIL - Blocking problem', 'FAIL'],
    ['heading FAIL', '## Verdict\n# **FAIL**', 'FAIL'],
    ['plain PASS', '## Verdict\nPASS - No blockers', 'PASS'],
    ['bold PASS', '## Verdict\n**PASS** - No blockers', 'PASS'],
    ['conflicting decisions', '## Verdict\n**PASS**\n**FAIL**', 'UNKNOWN'],
    ['no decision', '## Verdict\nEverything looks fine', 'UNKNOWN'],
    ['word FAILURE', '## Verdict\nFAILURE is not a decision', 'UNKNOWN'],
    ['missing heading', '## Summary\nPASS', 'UNKNOWN'],
    ['ignore summary text', '## Summary\nFAIL in unrelated text\n## Verdict\n**PASS**', 'PASS'],
  ] as const;

  for (const [name, report, expected] of cases) {
    it(name, () => {
      expect(parseDeclaredVerdict(report)).toBe(expected);
    });
  }
});

describe('report validation', () => {
  it('rejects an ambiguous verdict rather than approving it', () => {
    const result = validateReport(
      '## Summary\nSummary\n## Verdict\nNo decision specified',
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Missing or ambiguous verdict decision: expected PASS or FAIL',
    );
  });

  it('accepts an explicit no-findings PASS', () => {
    const result = validateReport(
      '## Summary\nNo findings\n## Verdict\n**PASS** - Safe',
    );
    expect(result.valid).toBe(true);
  });

  it('preserves a table-only P0 count for fail-closed aggregation', () => {
    const result = validateReport(
      '## Summary\nFound issue\n## Findings\n| P0 | 1 |\n## Verdict\nFAIL',
    );
    expect(result.statistics.p0_count).toBe(1);
  });
});
