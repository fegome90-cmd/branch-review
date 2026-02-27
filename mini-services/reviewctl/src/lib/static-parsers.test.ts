import { describe, expect, test } from 'bun:test';
import {
  parseBiomeSummary,
  parseRuffSummary,
} from './static-parsers.js';

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

  test('returns UNKNOWN for ambiguous/unrecognized output', () => {
    const result = parseBiomeSummary('Some random biome output without known patterns');
    expect(result.status).toBe('UNKNOWN');
    expect(result.issues).toBe(0);
  });
});
