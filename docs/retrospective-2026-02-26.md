# Retrospective — 2026-02-26

## Metadata

- Date: 2026-02-26
- Scope: Backend hardening + CLI workflow enforcement
- PRs: #4, #5
- Participants: User + coding agent

## 1) Goals vs outcome

### Planned goals

- Harden backend API patterns (validation, auth, errors, observability).
- Enforce deterministic commit/PR flow through CLI wrappers and hooks.
- Reduce operational mistakes in branch, PR, and merge lifecycle.

### Delivered outcomes

- Unified API envelope (`data`, `error`) and typed command service.
- Added rate limiting, concurrency lock, payload limits, token rotation support.
- Added structured logs with request ids.
- Enforced flow wrappers via `pre-commit`, `pre-pr`, and `pre-push`.
- Added CLI usage docs and policy in `AGENTS.md`.

### Delta

- Typecheck strategy required scope separation (`typecheck:app`) due unrelated global failures.

## 2) What worked well

- Plan-first execution with `tmux-plan-auditor` improved focus and prioritization.
- Explicit user confirmation (`approved/rejected/deferred`) prevented accidental overreach.
- End-to-end CLI flow reduced manual drift in commit/PR operations.

## 3) Frictions / incidents

1. Mixed pre-existing branch state.
   - Impact: risk of unrelated files in commits.
   - Root cause: working from non-clean branch context.
   - Detection: during staging/status checks.

2. Global typecheck failures outside scope.
   - Impact: blocked quality gate when not relevant to app scope.
   - Root cause: single `typecheck` command included unrelated modules/examples.
   - Detection: gate execution before PR.

3. Shell quoting in PR comments.
   - Impact: accidental command expansion in comment command.
   - Root cause: unescaped backticks in shell argument.
   - Detection: immediate CLI error output.

## 4) Anti-patterns detected

- Running PR flow from branch with unrelated dirty changes.
- Using shell command bodies with unescaped markdown backticks.
- Assuming single typecheck scope fits all changes.

## 5) Improvement actions

| Action                                                | Owner | Priority | Due date   | Success metric                               |
| ----------------------------------------------------- | ----- | -------- | ---------- | -------------------------------------------- |
| Add operating rules doc and retro template            | Team  | High     | Next cycle | Docs present and referenced in README        |
| Keep typecheck commands by scope (`app`, `all`, etc.) | Team  | High     | Next cycle | Pre-PR gate matches change scope             |
| Enforce wrapper-only commit/PR flow                   | Team  | High     | Done       | Hooks block bypass paths                     |
| Add artifact guardrail for `_ctx/review_runs/**`      | Team  | Medium   | Next cycle | Product PRs exclude run artifacts by default |

## 6) Guardrails to add/update

- Hooks/policy/docs updated for wrapper flow and pre-PR marker validation.
- Keep improving hook errors with precise remediation hints.
- Document branch hygiene before deletion (`ahead/behind` check vs `origin/main`).

## 7) Reusable patterns captured

1. **Plan audit gate before implementation**
   - Apply when plan affects multiple phases or risk is medium/high.
   - Command: `run_tmux_plan_audit.sh <PLAN_PATH> [SESSION] [RUN_ID]`

2. **Approve-only patch application**
   - Apply when automated/auditor outputs suggest multiple changes.
   - Rule: apply only `approved` items from deduplicated patch candidates.

3. **CLI-enforced delivery**
   - Apply to all commit/PR workflows.
   - Commands: `flow:commit`, `flow:prepr`, `flow:pr`.

## 8) Next cycle entry criteria

- [x] Rules updated
- [x] Scripts/hooks validated
- [x] Docs linked from README
- [x] Smoke flow executed
