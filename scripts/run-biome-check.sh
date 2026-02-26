#!/usr/bin/env bash
set -euo pipefail

DIFF_RANGE="${1:-${BR_DIFF_RANGE:-main...HEAD}}"

mapfile -t BIOME_FILES < <(
  git diff --name-only --diff-filter=ACMR "$DIFF_RANGE" \
    | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc)$' || true
)

if [[ "${#BIOME_FILES[@]}" -eq 0 ]]; then
  echo "No JS/TS files to validate with Biome"
  exit 0
fi

bunx @biomejs/biome check --files-ignore-unknown=true "${BIOME_FILES[@]}"
