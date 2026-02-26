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

# Run Biome in batches to avoid exceeding shell argument length limits
CHUNK_SIZE=200
total_files=${#BIOME_FILES[@]}

for ((i = 0; i < total_files; i += CHUNK_SIZE)); do
  batch=( "${BIOME_FILES[@]:i:CHUNK_SIZE}" )
  bunx @biomejs/biome check --files-ignore-unknown=true "${batch[@]}"
done
