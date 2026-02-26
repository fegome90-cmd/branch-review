#!/usr/bin/env bash
set -euo pipefail

DIFF_RANGE="${1:-${BR_DIFF_RANGE:-main...HEAD}}"
RUFF_VERSION="${RUFF_VERSION:-0.14.10}"

# Ensure user-installed scripts are discoverable (pip --user -> ~/.local/bin)
export PATH="$HOME/.local/bin:$PATH"

PYTHON_DIFF_OUTPUT=""
if ! PYTHON_DIFF_OUTPUT=$(git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" -- '*.py' '*.pyi'); then
  echo "git diff failed for Ruff check (range: $DIFF_RANGE)" >&2
  exit 1
fi

if [[ -z "$PYTHON_DIFF_OUTPUT" ]]; then
  echo "No Python files to validate with Ruff"
  exit 0
fi

mapfile -t PYTHON_FILES <<< "$PYTHON_DIFF_OUTPUT"

# Ensure Ruff exists (install if missing)
if ! command -v ruff >/dev/null 2>&1; then
  python3 -m pip install --user --disable-pip-version-check --upgrade "ruff==${RUFF_VERSION}"
fi

# Run Ruff in batches to avoid exceeding shell argument length limits
BATCH_SIZE=1000
for ((i = 0; i < ${#PYTHON_FILES[@]}; i += BATCH_SIZE)); do
  batch=("${PYTHON_FILES[@]:i:BATCH_SIZE}")

  # Prefer CLI; fallback to module invocation if PATH/shim is weird
  if command -v ruff >/dev/null 2>&1; then
    ruff check "${batch[@]}"
  else
    python3 -m ruff check "${batch[@]}"
  fi
done
