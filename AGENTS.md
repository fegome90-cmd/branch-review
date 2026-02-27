# AGENTS.md

Repository-level instructions for coding agents in `branch-review`.

## Purpose

Work safely on the Next.js + Bun codebase and on the `reviewctl` CLI workflow.

## Build and Validation

- Install deps: `bun install`
- Dev server: `bun run dev`
- Lint: `bun run lint`
- Lint Biome: `bun run lint:biome`
- Lint Ruff (Python): `bun run lint:ruff`
- Lint Pyright (Python types): `bun run lint:pyright`
- Lint All: `bun run lint:all`
- Tests: `bun test`
- Typecheck app scope: `bun run typecheck:app`
- Typecheck mini-services scope: `bun run typecheck:mini-services`
- Full scoped typecheck: `bun run typecheck:all`

## Linting Configuration

- **ESLint**: TypeScript/JavaScript (`.eslintrc`)
- **Biome**: TS/JS/JSON formatting and linting (`biome.json`)
- **Ruff**: Python linting and formatting (`ruff.toml`)
- **Pyright**: Python type checking (`pyrightconfig.json`)

Pre-commit hooks run via `lint-staged`:

- TS/JS/JSX: ESLint + Biome
- JSON: Biome
- Markdown/CSS/YAML: Prettier
- Python: Ruff check + format

## `reviewctl` CLI help + quick usage (required)

When a task involves review orchestration, always do this first:

1. Show CLI help:
   - `bun mini-services/reviewctl/src/index.ts help`
2. Follow the standard flow:
   - `reviewctl init`
   - `reviewctl explore context`
   - `reviewctl explore diff`
   - `reviewctl plan`
   - `reviewctl run`
   - `reviewctl ingest --agent <name>`
   - `reviewctl verdict`

If using direct Bun execution, prefix with:

- `bun mini-services/reviewctl/src/index.ts <command> ...`

## Commit + PR CLI Flow (mandatory)

When the task includes commit/push/PR/merge operations, use the project CLI wrappers:

- Create branch: `bun run flow:branch -- <type/short-name>`
- Commit: `bun run flow:commit -- -m "type(scope): message"`
- Pre-PR checks: `bun run flow:prepr`
- Create PR: `bun run flow:pr -- "PR title" "PR body" --base main`
- Merge PR: `bun run flow:merge -- <pr-number> [--squash|--merge|--rebase]`

Hook enforcement in this repo:

- `pre-commit` blocks direct commits unless `flow:commit` is used.
- `pre-commit` blocks staged `_ctx/review_runs/**` artifacts unless `ALLOW_CTX_ARTIFACTS=1`.
- `pre-pr` runs lint + biome + ruff + test + typecheck scope and writes a marker.
- `pre-push` blocks pushes when the `pre-pr` marker is missing/stale for current HEAD.

## Working Rules

- Modify only files required by the task.
- Prefer minimal, reversible changes over broad refactors.
- Validate with lint + tests + relevant typecheck before finishing.
- Keep API responses consistent with project conventions.

## References

- `README.md`
- `CLAUDE.md`
- `docs/plans/`
- `mini-services/reviewctl/src/index.ts`
