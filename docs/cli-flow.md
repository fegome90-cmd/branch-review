# CLI Flow (mandatory)

This document describes the **internal `branch-review` maintainer flow**. If
you want to use `reviewctl` from another repository, follow
`/reviewctl-quick-start.md` instead of copying the full internal hook flow.

1. Create branch from updated main:
   - `bun run flow:branch -- <type/short-name>`
2. Stage changes:
   - `git add <files>`
3. Commit only via wrapper:
   - `bun run flow:commit -- -m "type(scope): message"`
4. Run pre-PR gate:
   - `bun run flow:prepr`
   - Default typecheck scope: `app`
   - Override: `BR_PREPR_TYPECHECK_SCOPE=mini-services bun run flow:prepr`
   - Optional quick static checks (CI parity):
     - `BR_BIOME_SINCE=origin/main bash scripts/run-biome-check.sh`
     - `BR_DIFF_RANGE=origin/main...HEAD bash scripts/run-ruff-check.sh`
5. Push branch:
   - `git push -u origin <branch>`
6. Create PR via wrapper:
   - `bun run flow:pr -- "PR title" "PR body" --base main`
   - This now triggers **post-PR learning** automatically (`scripts/post-pr-learning.sh`).
7. Wait checks and address feedback:
   - `gh pr checks <number> --watch`
   - Fetch/review PR comments via wrapper:
     - `bun run flow:pr-comments -- review [--pr <number>] [--repo <owner/repo>]`
   - Reply to inline comments from CLI:
     - `bun run flow:pr-comments -- reply --comment-id <id> --body "Fixed in latest commit" [--repo <owner/repo>]`
8. Merge approved PR via wrapper:
   - `bun run flow:merge -- <pr-number> [--squash|--merge|--rebase]`
9. Sync local main (done automatically by `flow:merge`, keep as fallback):
   - `git checkout main && git pull --ff-only`

## reviewctl orchestration standard (mandatory)

For review orchestration tasks, use the canonical path A (no shortcuts):

1. `bun mini-services/reviewctl/src/index.ts help`
2. `bun mini-services/reviewctl/src/index.ts init` (or `init --create`)
3. `bun mini-services/reviewctl/src/index.ts explore context`
4. `bun mini-services/reviewctl/src/index.ts explore diff`
5. `bun mini-services/reviewctl/src/index.ts plan`
6. `bun mini-services/reviewctl/src/index.ts run` (use `--no-plan` only when explicitly needed)
7. `bun mini-services/reviewctl/src/index.ts ingest --agent <name> --input <file>`
8. `bun mini-services/reviewctl/src/index.ts verdict`

Why: `run` generates handoff requests (`REQUEST_*.md`) and task status artifacts, enabling reproducible multi-agent reviews and consistent auditability.

Scope rules:

- `reviewctl` operates on branch diff / worktree diff range, not on ad-hoc file lists.
- In isolated worktrees, resolve base/target branch metadata before `run`.
- Fail early if the run has no resolvable diff scope.

Static gate rules:

- `biome` applies only when the diff touches JS/TS scope.
- `ruff` should run diff-scoped via `BR_DIFF_RANGE=<base>...HEAD bash scripts/run-ruff-check.sh`.
- `pytest` should not default to repo-wide execution for isolated worktrees when there is no scoped Python test target.
- Status semantics must distinguish `PENDING`, `PENDING_NO_CONFIG`, `SKIP`, and `NOT_APPLICABLE`.

## External-safe usage (CLI-only)

For adoption from another repository:

1. Run `bash /path/to/branch-review/scripts/install-reviewctl.sh`
2. Export `REVIEWCTL_CORE_CLI_PATH=/path/to/branch-review/mini-services/reviewctl/src/index.ts`
3. Optionally export `REVIEW_API_TOKEN` and `BRANCH_REVIEW_API`
4. Source the installed wrapper from the target repo
5. Run `reviewctl_doctor`
6. Use wrapper commands such as `reviewctl_status` or `reviewctl_plan`

Important:

- This is a separate workflow from `flow:branch`, `flow:commit`, and Husky hooks.
- Current external use is safest in a disposable clone or worktree.
- Artifact isolation is not fully hardened yet; avoid treating wrapper output as read-only.

## PR comments workflow (gh wrapper)

Use this wrapper to ingest CodeRabbit/Copilot/GitHub comments into local artifacts and a TODO file.

- Review current branch PR comments:
  - `bun run flow:pr-comments -- review`
- Fetch only:
  - `bun run flow:pr-comments -- fetch --pr <number> --repo <owner/repo>`
- Generate TODO from previously fetched comments:
  - `bun run flow:pr-comments -- todo --pr <number>`
- Reply to an inline PR comment:
  - `bun run flow:pr-comments -- reply --comment-id <id> --body "..." [--repo <owner/repo>]`
- Auto-reply in batch (explicit opt-in):
  - `bun run flow:pr-comments -- reply --apply --from <todo.md|replies.json> [--repo <owner/repo>] [--dry-run] [--limit <n>]`

Artifacts are written to `_ctx/pr_comments/pr-<number>/`:

- `inline-comments.json`
- `reviews.json`
- `issue-comments.json`
- `comments.txt`
- `todo.md`

Note: `_ctx/pr_comments/pr-<number>/` artifacts are local/generated workflow output and should generally not be committed. As with other `_ctx/*` artifacts, staged context artifacts may be blocked by repo guards unless `ALLOW_CTX_ARTIFACTS=1` is explicitly set for an intentional one-off commit.

## Post-PR learning (auto + manual)

After PR creation, the flow runs a best-effort post-PR learning hook.

- Auto trigger: `bun run flow:pr -- ...`
- Manual trigger: `bun run flow:postpr-learning`
- Current behavior:
  - writes `skills/learned/_last-post-pr-learning.md`
  - optionally executes `scripts/post-pr-learning.local.sh` if present
- Failure policy: non-blocking (warnings only) so PR creation is not interrupted.
