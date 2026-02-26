# Operating Rules

Repository operating rules for engineering changes in `branch-review`.

## 1) Branching and scope

1. Start from updated main:
   - `git checkout main && git pull --ff-only`
2. Create a focused branch:
   - `git checkout -b <type/short-name>`
3. Keep one primary concern per PR.
4. Target PR size: `<= 300` net LOC when possible (excluding lockfiles/snapshots).

## 2) Mandatory CLI flow (commit/PR)

Use project wrappers (do not bypass):

1. Stage files: `git add <files>`
2. Commit: `bun run flow:commit -- -m "type(scope): message"`
3. Pre-PR gate: `bun run flow:prepr`
4. Push: `git push -u origin <branch>`
5. PR creation: `bun run flow:pr -- "PR title" "PR body" --base main`

## 3) Validation gates

Minimum gate before opening/merging PR:

- `bun run lint`
- `bun test`
- `bun run typecheck:app` (when available)

If scope includes mini-services, run additional checks explicitly.

## 4) Artifacts and guardrails

1. Do not include operational artifacts (`_ctx/review_runs/**`) in product PRs.
2. If a run artifact must be committed, use explicit override and explain why in PR.
3. Keep generated and runtime files out of staged changes unless required by task.

## 5) Review and merge

1. Wait for PR checks to pass.
2. Address feedback in small commits.
3. Merge via CLI with deterministic mode (`--squash` unless policy says otherwise).
4. Sync local main after merge.

## 6) Error and observability standards

1. Hooks/scripts must return actionable errors (`what failed` + `how to fix`).
2. Avoid exposing secrets in logs, hook output, or PR text.
3. Keep decisions traceable (plan, checks, and PR notes).

## 7) Cleanup and safety

1. Before deleting branches, verify diff vs `origin/main`.
2. Keep non-merged work in branch or stash with descriptive message.
3. Prefer reversible changes; avoid broad refactors without explicit approval.

## Related docs

- `docs/cli-flow.md`
- `docs/plans/operating-model-improvement-plan-2026-02-26.md`
- `AGENTS.md`
