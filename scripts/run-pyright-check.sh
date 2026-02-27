#!/usr/bin/env bash
set -euo pipefail

# Run pyright type checking on Python files
# Usage: scripts/run-pyright-check.sh [diff-range]

DIFF_RANGE="${1:-${BR_DIFF_RANGE:-main...HEAD}}"

# Ensure pyright is available
if ! command -v pyright >/dev/null 2>&1; then
  echo "Installing pyright..."
  npm install -g pyright 2>/dev/null || bun install -g pyright 2>/dev/null || {
    echo "⚠ pyright not available, skipping Python type check"
    exit 0
  }
fi

# Check if there are Python files to validate
PYTHON_DIFF_OUTPUT=""
if PYTHON_DIFF_OUTPUT=$(git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" -- '*.py' '*.pyi' 2>/dev/null); then
  if [[ -z "$PYTHON_DIFF_OUTPUT" ]]; then
    echo "No Python files to validate with pyright"
    exit 0
  fi
else
  echo "No Python files to validate with pyright"
  exit 0
fi

echo "Running pyright on changed Python files..."
echo "$PYTHON_DIFF_OUTPUT" | head -20

# Run pyright on the project
pyright --warnings 2>&1 || {
  echo "❌ pyright found type errors"
  exit 1
}

echo "✅ pyright check passed"
