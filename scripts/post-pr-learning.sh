#!/usr/bin/env bash
set -euo pipefail

PREFIX="[flow:postpr-learning]"

log() {
  echo "${PREFIX} $*"
}

warn() {
  echo "${PREFIX} WARN: $*" >&2
}

PR_URL=""
PR_NUMBER=""
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr-url)
      if [[ -z "${2:-}" ]]; then
        warn "--pr-url requires a value"
        exit 2
      fi
      PR_URL="$2"
      shift 2
      ;;
    --pr)
      if [[ -z "${2:-}" ]]; then
        warn "--pr requires a value"
        exit 2
      fi
      PR_NUMBER="$2"
      shift 2
      ;;
    --repo)
      if [[ -z "${2:-}" ]]; then
        warn "--repo requires a value"
        exit 2
      fi
      REPO="$2"
      shift 2
      ;;
    *)
      warn "Unknown arg ignored: $1"
      shift
      ;;
  esac
done

BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -z "$REPO" ]]; then
  REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -n "$REMOTE_URL" ]]; then
    REPO="$(echo "$REMOTE_URL" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
  fi
fi

if [[ -z "$PR_NUMBER" ]] && command -v gh >/dev/null 2>&1; then
  PR_NUMBER="$(gh pr view --json number --jq '.number' 2>/dev/null || true)"
fi

if [[ -z "$PR_URL" ]] && [[ -n "$PR_NUMBER" ]] && [[ -n "$REPO" ]]; then
  PR_URL="https://github.com/${REPO}/pull/${PR_NUMBER}"
fi

mkdir -p skills/learned
OUT_FILE="skills/learned/_last-post-pr-learning.md"

{
  echo "# Post-PR learning summary"
  echo
  echo "- timestamp: ${TS}"
  echo "- branch: ${BRANCH}"
  echo "- repo: ${REPO:-unknown}"
  echo "- pr_number: ${PR_NUMBER:-unknown}"
  echo "- pr_url: ${PR_URL:-unknown}"
  echo "- status: best-effort-completed"
  echo
  echo "No dedicated learning extractor is configured in this repository yet."
  echo "This marker confirms post-PR learning hook execution and preserves traceability."
} >"${OUT_FILE}"

if [[ -f "scripts/post-pr-learning.local.sh" ]]; then
  if bash scripts/post-pr-learning.local.sh; then
    log "executed scripts/post-pr-learning.local.sh"
  else
    warn "local learning hook failed (ignored; best-effort)"
  fi
fi

log "summary written: ${OUT_FILE}"
exit 0
