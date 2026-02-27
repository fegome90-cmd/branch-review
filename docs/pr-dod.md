# PR Definition of Done (DoD)

A PR is ready to merge only when all items below are true.

## 1) Scope and intent

- [ ] One primary concern per PR.
- [ ] Title follows Conventional Commits format.
- [ ] Description explains what changed and why.

## 2) Validation gates

- [ ] `bun run lint` passed.
- [ ] `bun test` passed.
- [ ] `bun run flow:prepr` passed with explicit scope if needed:
  - `BR_PREPR_TYPECHECK_SCOPE=app|mini-services|all|none`

## 3) Flow guardrails

- [ ] Commit was created through `bun run flow:commit -- -m "..."`.
- [ ] PR was created through `bun run flow:pr -- "title" "body" --base main`.
- [ ] No `_ctx/review_runs/**` artifacts included unless explicitly approved.

## 4) Review quality

- [ ] Risky changes include tests or clear mitigation.
- [ ] Errors are explicit and actionable (no silent failures).
- [ ] Security-sensitive changes validate input and avoid secret leakage.
- [ ] PR review comments were triaged/addressed (optional helper):
  - `bun run flow:pr-comments -- review`

## 5) Merge readiness

- [ ] CI checks are green.
- [ ] Required review feedback addressed.
- [ ] Merge strategy selected (`squash` by default unless policy differs).
