#!/usr/bin/env bash
set -euo pipefail

SINCE_REF="${1:-${BR_BIOME_SINCE:-}}"

# Backward compatibility for callers that still pass BR_DIFF_RANGE="base...HEAD".
if [[ -z "$SINCE_REF" && -n "${BR_DIFF_RANGE:-}" ]]; then
  if [[ "$BR_DIFF_RANGE" == *"..."* ]]; then
    SINCE_REF="${BR_DIFF_RANGE%%...*}"
  elif [[ "$BR_DIFF_RANGE" == *".."* ]]; then
    SINCE_REF="${BR_DIFF_RANGE%%..*}"
  fi
fi

SINCE_REF="${SINCE_REF:-main}"

if ! git rev-parse --verify --quiet "${SINCE_REF}^{commit}" >/dev/null; then
  echo "Invalid Biome --since ref: ${SINCE_REF}" >&2
  exit 1
fi

bunx @biomejs/biome check \
  --changed \
  --since="$SINCE_REF" \
  --files-ignore-unknown=true \
  --no-errors-on-unmatched
