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
8. Merge approved PR via wrapper:
   - `bun run flow:merge -- <pr-number> [--squash|--merge|--rebase]`
9. Sync local main (done automatically by `flow:merge`, keep as fallback):
   - `git checkout main && git pull --ff-only`

## Post-PR learning (auto + manual)

After PR creation (or PR detection on the current branch), the flow runs a learning pass that extracts reusable decision patterns as skills.

- Auto trigger: `bun run flow:pr -- ...`
- Manual trigger: `bun run flow:postpr-learning`
- Config: `scripts/post-pr-learning.config.json`
- Output directory: `skills/learned/<skill-id>/`
  - `SKILL.md`
  - `provenance.json`
- Latest run summary: `skills/learned/_last-post-pr-learning.md`
