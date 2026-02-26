#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: bun run flow:commit -- -m \"type(scope): message\""
  exit 1
fi

BR_REVIEW_USE_CLI_FLOW=1 git commit "$@"
