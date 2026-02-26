#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: bun run flow:pr -- \"PR title\" \"PR body\" [--base <branch>]"
  exit 1
fi

TITLE="$1"
BODY="$2"
shift 2

bash .husky/pre-pr

gh auth status >/dev/null

gh pr create --title "$TITLE" --body "$BODY" "$@"
