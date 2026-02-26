#!/usr/bin/env bash
set -euo pipefail

DIFF_RANGE="${1:-${BR_DIFF_RANGE:-main...HEAD}}"

mapfile -t PYTHON_FILES < <(
  git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" \
    | grep -E '\.pyi?$' || true
)

if [[ "${#PYTHON_FILES[@]}" -eq 0 ]]; then
  echo "No Python files to validate with Ruff"
  exit 0
fi

if ! command -v ruff >/dev/null 2>&1; then
  python3 -m pip install --user --disable-pip-version-check "ruff==0.9.10"
  export PATH="$HOME/.local/bin:$PATH"
fi

# Run Ruff in batches to avoid exceeding shell argument length limits
BATCH_SIZE=1000
for ((i = 0; i < ${#PYTHON_FILES[@]}; i += BATCH_SIZE)); do
  batch=("${PYTHON_FILES[@]:i:BATCH_SIZE}")
  ruff check "${batch[@]}"
done
