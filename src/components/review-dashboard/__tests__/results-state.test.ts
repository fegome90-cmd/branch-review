import { describe, expect, it } from 'bun:test';
import {
  formatNetChange,
  getDriftBadgeVariant,
  getVerdictBorderClass,
} from '@/components/review-dashboard/results-state';

describe('results-state helpers', () => {
  it('returns verdict border class', () => {
    expect(getVerdictBorderClass('PASS')).toBe('border-green-500');
    expect(getVerdictBorderClass('FAIL')).toBe('border-red-500');
  });

  it('formats net change with explicit plus sign', () => {
    expect(formatNetChange(12, 4)).toBe('+8');
    expect(formatNetChange(4, 8)).toBe('-4');
    expect(formatNetChange(5, 5)).toBe('0');
  });

  it('maps drift status to badge variant', () => {
    expect(getDriftBadgeVariant('ALIGNED')).toBe('default');
    expect(getDriftBadgeVariant('DRIFT_RISK')).toBe('secondary');
    expect(getDriftBadgeVariant('DRIFT_CONFIRMED')).toBe('destructive');
  });
});
