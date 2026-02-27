# CLI Flow (mandatory)

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
2. `bun mini-services/reviewctl/src/index.ts init --create --base main --target <branch>`
   - `--base`: base branch to compare against (default: auto-detect main/master/develop)
   - `--target`: branch to review (default: HEAD/current branch)
   - `--branch`: deprecated (use `--target` instead)
3. `bun mini-services/reviewctl/src/index.ts explore context`
4. `bun mini-services/reviewctl/src/index.ts explore diff`
5. `bun mini-services/reviewctl/src/index.ts plan`
6. `bun mini-services/reviewctl/src/index.ts run`
   - Fails if drift detected (HEAD or digests changed since explore/plan)
   - Use `--allow-drift` only for debug (leaves `DRIFT OVERRIDE USED` trace)
7. `bun mini-services/reviewctl/src/index.ts status [--last|--run-id <id>] [--json]`
   - Show progress: explore/plan/agents/statics/drift/warnings/verdict
8. `bun mini-services/reviewctl/src/index.ts ingest --agent <name> --input <file>`
   - Reports with missing recommended sections generate WARN (non-blocking)
   - Reports with missing required sections generate ERROR (blocking)
9. `bun mini-services/reviewctl/src/index.ts verdict`
   - Includes warnings count and breakdown by agent
   - Shows `DRIFT OVERRIDE USED: YES/NO` in final report

Why: `run` generates handoff requests (`REQUEST_*.md`) and task status artifacts, enabling reproducible multi-agent reviews and consistent auditability.

### Drift protection

The workflow tracks digests and HEAD SHAs to detect drift:

- `explore context`: records `head_sha_at_explore`, `context_digest`
- `explore diff`: records `base_sha`, `target_sha`, `diff_digest`
- `plan`: records `head_sha_at_plan`, `plan_digest`
- `run`: validates drift before generating requests

If drift is detected, `run` fails with instructions to re-run explore/plan. Use `--allow-drift` only for debugging (audit trail is preserved).

### Branch naming

Review branches follow: `review/<base>--<target>--<shortsha>`

- Example: `review/main--feat_api-discovery--a0c1535`
- Slashes in branch names are replaced with underscores for safety

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
