# Report: code-reviewer

## Meta
- **Run ID**: run_20260226_61dea96e
- **Agent**: code-reviewer
- **Timestamp**: 2026-02-26T15:10:00Z
- **Execution Time**: 30s

## Summary
Found a critical SQL injection vulnerability in the authentication module.

## Findings

### P0 (Critical - Blocking)

#### Finding P0-1: SQL Injection in login query
- **Location**: `src/auth/login.ts:42`
- **Description**: User input directly interpolated into SQL query
- **Evidence**: 
  ```
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  ```
- **Impact**: Attacker can execute arbitrary SQL, access all user data
- **Fix Suggestion**: Use parameterized queries

### P1 (Important - Should Fix)

No P1 findings detected.

### P2 (Minor - Nice to Fix)

No P2 findings detected.

## Statistics
| Priority | Count |
|----------|-------|
| P0 | 1 |
| P1 | 0 |
| P2 | 0 |

## Verdict
**FAIL** - Critical SQL injection vulnerability found
