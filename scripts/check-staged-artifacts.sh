#!/usr/bin/env bash
set -euo pipefail

if [[ "${ALLOW_CTX_ARTIFACTS:-}" == "1" ]]; then
  echo "ℹ artifact guard: ALLOW_CTX_ARTIFACTS=1 (bypass enabled)"
  exit 0
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)
if [[ -z "$STAGED_FILES" ]]; then
  exit 0
fi

BLOCKED=$(echo "$STAGED_FILES" | grep -E '^_ctx/(review_runs|pr_comments)/' || true)
if [[ -z "$BLOCKED" ]]; then
  exit 0
fi

echo "❌ Commit blocked: staged operational artifacts detected"
echo "$BLOCKED"
echo "Unstage these files or run with ALLOW_CTX_ARTIFACTS=1 when explicitly intended."
exit 2
