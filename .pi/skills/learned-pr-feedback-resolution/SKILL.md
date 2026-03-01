---
name: learned-pr-feedback-resolution
description: |
  Use when addressing PR review feedback from bots (CodeRabbit, Copilot, GitHub Copilot) that needs systematic resolution.
  
  Triggers when:
  - PR has review comments from CodeRabbit, Copilot, or similar bots
  - User asks to "address PR feedback", "fix review comments", "resolve bot comments"
  - PR is blocked waiting for review feedback resolution
  - Comments span multiple categories (security, logic, docs, style)
  
  This skill converts bot feedback into prioritized WorkOrders with atomic commits.
---

# PR Feedback Resolution Workflow

## Why This Matters

Bot reviews (CodeRabbit, Copilot) can generate 10-30+ comments across security vulnerabilities, logic bugs, and style issues. Without a structured approach:
- Critical security issues get buried in noise
- Commits become messy and hard to review
- Easy to miss issues or duplicate work
- No clear progress tracking

This workflow ensures systematic resolution with atomic commits and clear documentation.

## Workflow

### Phase 1: Extract and Categorize

**Extract bot comments:**
```bash
# Get reviews from bot accounts
gh api repos/<owner>/<repo>/pulls/<pr>/reviews \
  --jq '.[] | select(.user.login | test("coderabbit|copilot|bot"; "i")) | {user: .user.login, state: .state, body: .body}'

# Get individual review comments
gh api repos/<owner>/<repo>/pulls/<pr>/comments \
  --jq '.[] | select(.user.login | test("coderabbit|copilot|bot"; "i")) | {file: .path, line: .line, body: .body}'
```

**Categorize by severity (process in this order):**

| Priority | Category | Examples | Why First |
|----------|----------|----------|-----------|
| CRITICAL | Security | Command injection, path traversal, XSS, secrets | Blockers for merge |
| HIGH | Logic | Race conditions, null checks, incorrect logic | Affects behavior |
| MEDIUM | Docs | MD lint, outdated examples, confusing docs | Non-blocking |
| LOW | Style | Formatting, naming conventions | Cosmetic only |

### Phase 2: Create WorkOrders

Group related issues into WorkOrders by category. Each WO becomes one atomic commit.

```
WO-001: Security (CRITICAL) - 3 issues
  - cmd-injection in shell.ts
  - path-traversal in file-utils.ts
  - hardcoded secret in config.ts

WO-002: Logic (HIGH) - 4 issues
  - race condition in async-handler.ts
  - missing null check in parser.ts
  - incorrect drift detection in status.ts
  - missing snapshot validation

WO-003: Docs (MEDIUM) - 5 issues
  - MD040 linting in README
  - outdated auth example
  - confusing CLI table
```

### Phase 3: Execute WorkOrders

**Execution order matters:** Security → Logic → Docs → Style

For each WO:
1. Fix all issues in that category
2. Run tests locally
3. Commit atomically
4. Verify CI passes before next WO

```bash
# One commit per WO - this enables easy revert if needed
git add <specific-files-for-wo-001>
bun run flow:commit -- -m "fix(security): prevent command injection and path traversal

- Escape shell arguments in shell.ts
- Validate paths in file-utils.ts
- Move secret to env in config.ts"

# After security is committed, move to logic
git add <specific-files-for-wo-002>
bun run flow:commit -- -m "fix(logic): race conditions and null checks"
```

**Why atomic commits per WO:**
- Easy to revert if a category introduces bugs
- Clear git history for reviewers
- Each commit is a logical unit
- Bisect-friendly if issues arise later

### Phase 4: Validate and Push

```bash
# Run full validation before push
bun run lint:all && bun test && bun run typecheck:all

# Fix any formatting issues
bunx prettier --write <modified-files>
bunx biome check --write <modified-files>

# Push all commits
git push
```

### Phase 5: Document Resolution

Post a checklist comment so reviewers can verify all issues were addressed:

```bash
gh pr comment <pr> --body "$(cat <<'EOF'
## Review Feedback Resolution

| # | File | Issue | Priority | Status | Commit |
|---|------|-------|----------|--------|--------|
| 1 | shell.ts | Command injection | CRITICAL | Fixed | abc1234 |
| 2 | file-utils.ts | Path traversal | CRITICAL | Fixed | abc1234 |
| 3 | config.ts | Hardcoded secret | CRITICAL | Fixed | abc1234 |
| 4 | async-handler.ts | Race condition | HIGH | Fixed | def5678 |
| 5 | parser.ts | Missing null check | HIGH | Fixed | def5678 |
| ... | ... | ... | ... | ... | ... |

All 13 issues resolved across 3 WorkOrders.
EOF
)"
```

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Mixing categories in one commit | One commit per WO category |
| Skipping local tests | Always run `bun test` before commit |
| Forgetting to format | Run prettier/biome before push |
| Not documenting resolution | Post checklist comment |

## Example: Full Workflow

PR #22 received 13 comments (12 CodeRabbit + 1 Copilot):

```bash
# 1. Extract
gh api repos/owner/repo/pulls/22/comments --jq '.[] | select(.user.login | contains("coderabbit"))'

# 2. Create plan: .pi/plan/pr22-review-feedback-fix.md
#    WO-001: Security (3 issues)
#    WO-002: Logic (4 issues)
#    WO-003: Docs (5 issues)
#    WO-004: CI fixes (1 issue)

# 3. Execute
bun run flow:commit -- -m "fix(security): ..."
bun run flow:commit -- -m "fix(logic): ..."
bun run flow:commit -- -m "fix(docs): ..."
bun run flow:commit -- -m "fix(ci): prettier and biome config"

# 4. Validate
bun run lint:all && bun test

# 5. Push and document
git push
gh pr comment 22 --body "## Review Feedback Resolution..."
```

## Quality Checklist

Before marking complete:
- [ ] All CRITICAL issues addressed first
- [ ] Each WO has its own atomic commit
- [ ] Tests pass after each WO
- [ ] CI passes before merge
- [ ] Checklist comment posted on PR

## Learned From

| Attribute | Value |
|-----------|-------|
| Session | 2026-02-27 |
| PR | #22 branch-review |
| Bots | CodeRabbit (12), Copilot (1) |
| Issues | 13 resolved |
| Commits | 7 atomic |
