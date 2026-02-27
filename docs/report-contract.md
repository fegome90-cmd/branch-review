# Report Contract (reviewctl)

This document defines the contract for agent and static analysis reports ingested by `reviewctl ingest`.

## Severity Levels

### ERROR (blocking)

Reports with errors block the review run and cannot be ingested successfully.

Common ERROR conditions:

- Missing required sections (Meta, Summary, Findings, Verdict)
- Output exceeds 120 lines limit
- Malformed JSON in structured fields

When an ERROR is detected:

- `ingest` exits with code 2
- Report is saved but marked as `INVALID`
- Agent is not counted as complete

### WARN (non-blocking)

Reports with warnings are accepted but flagged for follow-up.

Common WARN conditions:

- Missing recommended sections (Test Plan, Confidence, Statistics)
- Findings without proper evidence (file:line format)
- Deprecated field usage

When a WARN is detected:

- `ingest` succeeds (exit 0)
- Warnings are stored in `status.json` under `validation.warnings`
- Warnings are aggregated in `verdict` output

## Required Sections (ERROR if missing)

All agent reports must include:

1. **Meta section**
   - Run ID
   - Agent name
   - Timestamp

2. **Summary**
   - 1-2 sentence overview

3. **Findings**
   - P0/P1/P2 priority
   - Evidence with file:line references

4. **Verdict**
   - PASS or FAIL
   - Justification

## Recommended Sections (WARN if missing)

These sections improve report quality but don't block ingestion:

1. **Test Plan** - How to verify the findings
2. **Confidence** - Certainty level (0-100% or qualitative)
3. **Statistics** - Count of findings by priority

## Output Format

### Example minimal report

```markdown
# Report: code-reviewer

## Meta

- Run ID: run_20260227_abc123
- Agent: code-reviewer
- Timestamp: 2026-02-27T18:00:00Z

## Summary

Found 2 P1 issues related to error handling in API routes.

## Findings

### P1-1: Missing error handling in /api/users

- **Location**: `src/app/api/users/route.ts:45`
- **Description**: No try-catch around database call
- **Fix**: Wrap in error handler with proper logging

### P1-2: Unvalidated input in /api/posts

- **Location**: `src/app/api/posts/route.ts:23`
- **Description**: User input not validated before use
- **Fix**: Add Zod schema validation

## Verdict

**FAIL** - P1 findings require fixes before merge

## Test Plan

1. Add unit tests for error handling
2. Verify input validation with edge cases

## Confidence

High (90%) - Issues confirmed in code review
```

## Ingest Output

When ingesting a report, `reviewctl` shows severity-prefixed messages:

```
ERROR: Missing required section: Verdict
WARN: Missing recommended section: Confidence
```

## Verdict Integration

The `verdict` command aggregates warnings:

- `final.md` includes warnings count and breakdown by agent
- `final.json` includes:
  - `statistics.warnings_total`
  - `warnings_by_agent`
  - `drift.override_used`

## Static Analysis

Static tool output is parsed with policy-based severity:

### Ruff Policy

| Category         | Prefixes           | Blocking  |
| ---------------- | ------------------ | --------- |
| Errors/Security  | F, E, W            | Yes       |
| Style/Complexity | I, SIM, ARG, UP, B | No (WARN) |

Reports with only WARN-level static findings pass the static gate.

### Biome Policy

All Biome errors and warnings are currently blocking. Future versions may introduce similar policy-based classification.

## Validation Commands

Check report validity before ingest:

```bash
# Validate report structure (dry-run)
cat report.md | reviewctl ingest --agent code-reviewer

# Ingest with overwrite
reviewctl ingest --agent code-reviewer --input report.md --overwrite
```
