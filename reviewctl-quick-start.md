# Reviewctl Quick Start (Portable)

Portable review orchestration for `reviewctl`.

## Installation

From any repository, run the installer pointing at the source `branch-review` repository:

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

The token is never persisted to files. It must exist in the current shell session:

```bash
export REVIEW_API_TOKEN="your-secure-token"
```

Optionally, you can pin the core CLI path explicitly:

```bash
export REVIEWCTL_CORE_CLI_PATH="/path/to/branch-review/mini-services/reviewctl/src/index.ts"
```

## Runtime behavior

- The wrapper uses an API-first strategy.
- It falls back to local execution only when the API is unreachable at the transport level.
- If the API responds with `4xx` or `5xx`, the wrapper fails explicitly and does not perform a silent fallback.
- If `REVIEW_API_TOKEN` is missing, the wrapper uses direct local mode.
- Review scope remains diff-based; `reviewctl` reviews the branch diff, not ad-hoc file lists.

## Main commands

- `reviewctl_init`
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

## Portability gates

- No hardcoded absolute paths in the generated wrapper.
- No tokens persisted to files.
- Fish shell wrapper avoids `eval`.
- Arguments are serialized with stable semantics toward the API.
- Local fallback is limited to transport failures.
