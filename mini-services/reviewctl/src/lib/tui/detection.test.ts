import { describe, expect, test } from 'bun:test';
import { detectInteractiveTTY } from './detection.js';

describe('detectInteractiveTTY', () => {
  test('returns true when stdout/stderr are TTY', () => {
    const result = detectInteractiveTTY({ isTTY: true }, { isTTY: true });
    expect(result).toBe(true);
  });

  test('returns false when one stream is not TTY', () => {
    const result = detectInteractiveTTY({ isTTY: true }, { isTTY: false });
    expect(result).toBe(false);
  });
});
