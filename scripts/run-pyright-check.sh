#!/usr/bin/env bash
set -euo pipefail

# Run pyright type checking on Python files
# Usage: scripts/run-pyright-check.sh [diff-range]

DIFF_RANGE="${1:-${BR_DIFF_RANGE:-main...HEAD}}"

# Ensure pyright is available
if ! command -v pyright >/dev/null 2>&1; then
  echo "Installing pyright..."
  if ! npm install -g pyright 2>/dev/null && ! bun install -g pyright 2>/dev/null; then
    echo "❌ Failed to install pyright. Please install it manually: npm install -g pyright"
    exit 1
  fi
fi

# Check if there are Python files to validate
PYTHON_DIFF_OUTPUT=""
if ! PYTHON_DIFF_OUTPUT=$(git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" -- '*.py' '*.pyi' 2>&1); then
  echo "❌ git diff failed for DIFF_RANGE='$DIFF_RANGE'"
  echo "   Ensure the ref exists and is accessible."
  exit 1
fi

if [[ -z "$PYTHON_DIFF_OUTPUT" ]]; then
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
