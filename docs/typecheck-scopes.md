# Typecheck Scopes

Use scoped typechecks to avoid false negatives from unrelated areas.

## Commands

- `bun run typecheck:app`
  - Scope: `src/**` app/backend/frontend code via `tsconfig.app.json`.
- `bun run typecheck:mini-services`
  - Scope: `mini-services/reviewctl/src/**` via `tsconfig.mini-services.json`.
- `bun run typecheck:all`
  - Runs both `typecheck:app` and `typecheck:mini-services`.

## Pre-PR default behavior

`flow:prepr` uses `BR_PREPR_TYPECHECK_SCOPE` with default `app`.

Allowed values:

- `app` (default)
- `mini-services`
- `all`
- `none` (explicit skip, prints trace message)

Examples:

```bash
bun run flow:prepr
BR_PREPR_TYPECHECK_SCOPE=mini-services bun run flow:prepr
BR_PREPR_TYPECHECK_SCOPE=all bun run flow:prepr
```

## Local vs CI recommendation

- Local docs/code-only PRs: `app`.
- Local mini-services PRs: `mini-services` or `all`.
- Release/hardening checks: `all`.
- CI should choose scope explicitly to avoid ambiguity.
