#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-review}"
shift || true

if [[ "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  COMMAND="help"
fi

PR_NUMBER=""
REPO=""
OUT_DIR=""
COMMENT_ID=""
BODY=""

usage() {
  cat <<'EOF'
Usage:
  bun run flow:pr-comments -- review [--pr <number>] [--repo <owner/repo>] [--out-dir <dir>]
  bun run flow:pr-comments -- fetch [--pr <number>] [--repo <owner/repo>] [--out-dir <dir>]
  bun run flow:pr-comments -- todo  [--pr <number>] [--repo <owner/repo>] [--out-dir <dir>]
  bun run flow:pr-comments -- reply --comment-id <id> --body "<text>" [--repo <owner/repo>]

Commands:
  review  Fetches PR comments + generates TODO markdown (default)
  fetch   Downloads PR comment artifacts as JSON/TXT
  todo    Generates TODO markdown from inline PR comments
  reply   Replies to a specific inline PR comment
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pr)
        PR_NUMBER="${2:-}"
        shift 2
        ;;
      --repo)
        REPO="${2:-}"
        shift 2
        ;;
      --out-dir)
        OUT_DIR="${2:-}"
        shift 2
        ;;
      --comment-id)
        COMMENT_ID="${2:-}"
        shift 2
        ;;
      --body)
        BODY="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1"
        usage
        exit 2
        ;;
    esac
  done
}

ensure_gh() {
  command -v gh >/dev/null || { echo "❌ gh CLI not found"; exit 1; }
  gh auth status >/dev/null || { echo "❌ gh auth required: run 'gh auth login'"; exit 1; }
}

resolve_repo() {
  if [[ -n "$REPO" ]]; then
    echo "$REPO"
    return
  fi

  local remote_url
  remote_url="$(git remote get-url origin)"

  if [[ "$remote_url" =~ github.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi

  echo "❌ Could not infer GitHub repo from origin remote. Use --repo owner/repo" >&2
  exit 1
}

resolve_pr() {
  local repo="$1"

  if [[ -n "$PR_NUMBER" ]]; then
    echo "$PR_NUMBER"
    return
  fi

  gh pr view --repo "$repo" --json number -q .number
}

resolve_out_dir() {
  local pr="$1"
  if [[ -n "$OUT_DIR" ]]; then
    echo "$OUT_DIR"
  else
    echo "_ctx/pr_comments/pr-${pr}"
  fi
}

fetch_comments() {
  local repo="$1"
  local pr="$2"
  local out_dir="$3"

  mkdir -p "$out_dir"

  echo "▶ Fetching inline PR comments..."
  gh api "repos/${repo}/pulls/${pr}/comments?per_page=100" > "${out_dir}/inline-comments.json"

  echo "▶ Fetching PR reviews..."
  gh api "repos/${repo}/pulls/${pr}/reviews?per_page=100" > "${out_dir}/reviews.json"

  echo "▶ Fetching issue-level PR comments..."
  gh api "repos/${repo}/issues/${pr}/comments?per_page=100" > "${out_dir}/issue-comments.json"

  echo "▶ Fetching rendered comments snapshot..."
  gh pr view "$pr" --repo "$repo" --comments > "${out_dir}/comments.txt"

  echo "✅ Comments fetched into: ${out_dir}"
}

generate_todo() {
  local out_dir="$1"
  local todo_file="${out_dir}/todo.md"

  if [[ ! -f "${out_dir}/inline-comments.json" ]]; then
    echo "❌ Missing ${out_dir}/inline-comments.json. Run fetch first."
    exit 1
  fi

  if ! command -v jq >/dev/null; then
    echo "❌ jq is required to generate todo markdown from JSON"
    exit 1
  fi

  {
    echo "# PR Comments TODO"
    echo
    echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo
    echo "## Inline comments"
    echo

    jq -r '
      .[] |
      "- [ ] [id=\(.id)] \(.path):\((.line // .original_line // 0))\n  author: \(.user.login)\n  \(.body | gsub("\\n"; " "))\n"
    ' "${out_dir}/inline-comments.json"
  } > "$todo_file"

  echo "✅ TODO generated: ${todo_file}"
}

reply_inline_comment() {
  local repo="$1"

  if [[ -z "$COMMENT_ID" || -z "$BODY" ]]; then
    echo "❌ reply requires --comment-id <id> and --body \"text\""
    exit 2
  fi

  gh api \
    -X POST \
    "repos/${repo}/pulls/comments/${COMMENT_ID}/replies" \
    -f body="$BODY" >/dev/null

  echo "✅ Reply posted to comment ${COMMENT_ID}"
}

parse_args "$@"
ensure_gh

REPO_RESOLVED="$(resolve_repo)"

case "$COMMAND" in
  fetch)
    PR_RESOLVED="$(resolve_pr "$REPO_RESOLVED")"
    OUT_DIR_RESOLVED="$(resolve_out_dir "$PR_RESOLVED")"
    fetch_comments "$REPO_RESOLVED" "$PR_RESOLVED" "$OUT_DIR_RESOLVED"
    ;;
  todo)
    PR_RESOLVED="$(resolve_pr "$REPO_RESOLVED")"
    OUT_DIR_RESOLVED="$(resolve_out_dir "$PR_RESOLVED")"
    generate_todo "$OUT_DIR_RESOLVED"
    ;;
  review)
    PR_RESOLVED="$(resolve_pr "$REPO_RESOLVED")"
    OUT_DIR_RESOLVED="$(resolve_out_dir "$PR_RESOLVED")"
    fetch_comments "$REPO_RESOLVED" "$PR_RESOLVED" "$OUT_DIR_RESOLVED"
    generate_todo "$OUT_DIR_RESOLVED"
    echo ""
    echo "Artifacts:"
    echo "- ${OUT_DIR_RESOLVED}/inline-comments.json"
    echo "- ${OUT_DIR_RESOLVED}/reviews.json"
    echo "- ${OUT_DIR_RESOLVED}/issue-comments.json"
    echo "- ${OUT_DIR_RESOLVED}/comments.txt"
    echo "- ${OUT_DIR_RESOLVED}/todo.md"
    ;;
  reply)
    reply_inline_comment "$REPO_RESOLVED"
    ;;
  help)
    usage
    ;;
  *)
    echo "Unknown command: $COMMAND"
    usage
    exit 2
    ;;
esac
