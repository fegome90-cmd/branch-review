# Reviewctl Quick Start (Portable)

Portable review orchestration for `reviewctl`.

This guide is for **CLI-only adoption from another repository**. If you are
working inside `branch-review` itself, use `bun reviewctl ...` directly instead
of installing wrappers.

## Installation

From the repository where you want to use `reviewctl`, run the installer that
lives in the source `branch-review` repository:

```bash
bash /path/to/branch-review/scripts/install-reviewctl.sh
```

This creates:

- `./scripts/reviewctl-wrappers/reviewctl-wrapper.sh` (Bash/Zsh)
- `./scripts/reviewctl-wrappers/reviewctl-wrapper.fish` (Fish)

## Activation

Bash/Zsh:

```bash
source scripts/reviewctl-wrappers/reviewctl-wrapper.sh
```

Fish:

```fish
source scripts/reviewctl-wrappers/reviewctl-wrapper.fish
```

## Configuration

The wrappers are copied into your repo, but the core CLI still lives in the
source `branch-review` checkout. For external usage, set the core CLI path
explicitly in your shell session:

```bash
export REVIEWCTL_CORE_CLI_PATH="/path/to/branch-review/mini-services/reviewctl/src/index.ts"
```

The token is never persisted to files. It must exist in the current shell
session if you want API mode:

```bash
export REVIEW_API_TOKEN="your-secure-token"
```

You can also pin the API base URL if your API is not on the default port:

```bash
export BRANCH_REVIEW_API="http://localhost:3001"
```

## Runtime behavior

- The wrapper uses an API-first strategy.
- It falls back to local execution only when the API is unreachable at the transport level.
- If the API responds with `4xx` or `5xx`, the wrapper fails explicitly and does not perform a silent fallback.
- If `REVIEW_API_TOKEN` is missing, the wrapper uses direct local mode.
- In external repos today, `REVIEWCTL_CORE_CLI_PATH` is effectively required.
- Wrapper artifacts are copied into your repo under `scripts/reviewctl-wrappers/`.
- Review scope remains diff-based; `reviewctl` reviews the branch diff, not ad-hoc file lists.

## Safe adoption note

Current wrappers were designed first for `branch-review` itself. External-safe
path resolution and artifact isolation are being hardened separately. Until that
lands, prefer a disposable clone or worktree and keep `REVIEWCTL_CORE_CLI_PATH`
explicit.

## Main commands

- `reviewctl_init`
- `reviewctl_doctor`
- `reviewctl_plan`
- `reviewctl_run`
- `reviewctl_verdict`
- `reviewctl_status`
- `reviewctl_full_workflow`

## Minimal observability

The wrappers log execution context with fields such as:

- `mode=api|local-fallback|local-direct`
- `command=<cmd>`
- `http_status=<code>` when applicable
- `core_cli_path=<resolved path>`

Run `reviewctl_doctor` after activation to confirm CLI path, token mode, repo
policy, and artifact-root behavior before the first real run.

## Portability gates

- No hardcoded absolute paths in the generated wrapper.
- No tokens persisted to files.
- Fish shell wrapper avoids `eval`.
- Arguments are serialized with stable semantics toward the API.
- Local fallback is limited to transport failures.
