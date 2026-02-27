#!/usr/bin/env bash
set -euo pipefail

PREFIX="[flow:pr-comments]"

log() {
  echo "${PREFIX} $*"
}

warn() {
  echo "${PREFIX} WARN: $*" >&2
}

fail() {
  local code="$1"
  shift
  echo "${PREFIX} ERROR: $*" >&2
  exit "$code"
}

usage() {
  cat <<'EOF'
Usage:
  bun run flow:pr-comments -- review [--pr <number>] [--repo <owner/repo>]
  bun run flow:pr-comments -- fetch --pr <number> [--repo <owner/repo>]
  bun run flow:pr-comments -- todo --pr <number> [--repo <owner/repo>]
  bun run flow:pr-comments -- reply --comment-id <id> --body "..." [--repo <owner/repo>]
  bun run flow:pr-comments -- reply --apply --from <todo.md|json> [--repo <owner/repo>] [--dry-run] [--limit <n>]

Notes:
  - Exit codes: 0 success, 2 usage, 3 prerequisites/auth, 4 GitHub API failure, 5 partial apply failure.
  - Artifacts are written to _ctx/pr_comments/pr-<number>/.
  - Auto-apply mode is opt-in via --apply.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail 3 "Missing required command: $1"
}

ensure_auth() {
  if ! gh auth status >/dev/null 2>&1; then
    fail 3 "gh is not authenticated. Run: gh auth login"
  fi
}

infer_repo() {
  local remote_url
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  [[ -n "$remote_url" ]] || fail 3 "Could not infer repo from git remote 'origin'"

  local repo
  repo="$(echo "$remote_url" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
  [[ "$repo" == */* ]] || fail 3 "Could not parse GitHub repo from origin URL: $remote_url"

  echo "$repo"
}

infer_pr_number() {
  local repo="$1"
  local pr

  pr="$(gh pr view --repo "$repo" --json number --jq '.number' 2>/dev/null || true)"
  if [[ -n "$pr" && "$pr" != "null" ]]; then
    echo "$pr"
    return 0
  fi

  local branch
  branch="$(git branch --show-current 2>/dev/null || true)"
  pr="$(gh pr list --repo "$repo" --head "$branch" --json number --jq '.[0].number' 2>/dev/null || true)"
  if [[ -n "$pr" && "$pr" != "null" ]]; then
    echo "$pr"
    return 0
  fi

  fail 2 "Could not infer PR number. Pass --pr <number>."
}

artifact_dir_for_pr() {
  local pr="$1"
  echo "_ctx/pr_comments/pr-${pr}"
}

fetch_artifacts() {
  local repo="$1"
  local pr="$2"
  local dir
  dir="$(artifact_dir_for_pr "$pr")"

  mkdir -p "$dir"

  if ! gh api --paginate "repos/${repo}/pulls/${pr}/comments" | jq -s 'add // []' >"${dir}/inline-comments.json"; then
    fail 4 "Failed to fetch inline comments for PR #${pr}"
  fi
  if ! gh api --paginate "repos/${repo}/pulls/${pr}/reviews" | jq -s 'add // []' >"${dir}/reviews.json"; then
    fail 4 "Failed to fetch reviews for PR #${pr}"
  fi
  if ! gh api --paginate "repos/${repo}/issues/${pr}/comments" | jq -s 'add // []' >"${dir}/issue-comments.json"; then
    fail 4 "Failed to fetch issue comments for PR #${pr}"
  fi

  {
    echo "# PR ${pr} comments (${repo})"
    echo
    echo "## Inline comments"
    jq -r '.[] | "- [id:\(.id)] @\(.user.login) \(.path // "n/a") :: \(.html_url)\n  \(.body | gsub("\\r";"") | gsub("\\n";" ") | .[0:220])"' "${dir}/inline-comments.json"
    echo
    echo "## Issue comments"
    jq -r '.[] | "- [id:\(.id)] @\(.user.login) :: \(.html_url)\n  \(.body | gsub("\\r";"") | gsub("\\n";" ") | .[0:220])"' "${dir}/issue-comments.json"
    echo
    echo "## Reviews"
    jq -r '.[] | "- [id:\(.id)] @\(.user.login) state=\(.state // "UNKNOWN") :: \(.html_url // "n/a")"' "${dir}/reviews.json"
  } >"${dir}/comments.txt"

  echo "$dir"
}

generate_todo() {
  local repo="$1"
  local pr="$2"
  local dir
  dir="$(artifact_dir_for_pr "$pr")"

  [[ -f "${dir}/inline-comments.json" ]] || fail 2 "Missing ${dir}/inline-comments.json. Run fetch first."
  [[ -f "${dir}/issue-comments.json" ]] || fail 2 "Missing ${dir}/issue-comments.json. Run fetch first."

  {
    echo "# PR ${pr} review todo"
    echo
    echo "Repo: ${repo}"
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "## Inline comments (actionable via reply)"
    echo
    jq -r '.[] | "- [ ] REPLY \(.id) :: <your reply here>\n  - author: @\(.user.login)\n  - path: \(.path // "n/a")\n  - url: \(.html_url)\n  - note: \(.body | gsub("\\r";"") | gsub("\\n";" ") | .[0:260])\n"' "${dir}/inline-comments.json"
    echo
    echo "## Issue comments (context)"
    echo
    jq -r '.[] | "- [ ] issue-comment \(.id) @\(.user.login) :: \(.html_url)\n  - note: \(.body | gsub("\\r";"") | gsub("\\n";" ") | .[0:260])\n"' "${dir}/issue-comments.json"
    echo
    echo "## Auto-apply JSON template"
    echo
    echo '```json'
    echo '['
    echo '  { "comment_id": 123456789, "body": "Fixed in latest commit <sha>." }'
    echo ']'
    echo '```'
  } >"${dir}/todo.md"

  log "todo generated: ${dir}/todo.md"
}

reply_single() {
  local repo="$1"
  local comment_id="$2"
  local body="$3"

  [[ -n "$comment_id" ]] || fail 2 "--comment-id is required"
  [[ -n "$body" ]] || fail 2 "--body is required"

  if ! gh api "repos/${repo}/pulls/comments/${comment_id}/replies" -f body="$body" >/dev/null; then
    fail 4 "Failed to post reply to comment ${comment_id}"
  fi

  log "replied to comment ${comment_id}"
}

apply_replies() {
  local repo="$1"
  local from_file="$2"
  local dry_run="$3"
  local limit="$4"

  [[ -f "$from_file" ]] || fail 2 "--from file not found: ${from_file}"

  local parsed
  parsed="$(mktemp)"

  if [[ "$from_file" == *.json ]]; then
    jq -r '.[] | select(.comment_id and .body) | [(.comment_id|tostring), (.body|gsub("\n";" "))] | @tsv' "$from_file" >"$parsed"
  else
    awk 'match($0, /REPLY[[:space:]]+([0-9]+)[[:space:]]+::[[:space:]]+(.+)/, a) { if (a[2] !~ /<your reply here>/) print a[1] "\t" a[2] }' "$from_file" >"$parsed"
  fi

  local total=0 ok=0 failed=0
  while IFS=$'\t' read -r comment_id body; do
    [[ -n "${comment_id:-}" ]] || continue
    [[ -n "${body:-}" ]] || continue

    if [[ "$limit" -gt 0 && "$total" -ge "$limit" ]]; then
      break
    fi
    total=$((total + 1))

    if ! gh api "repos/${repo}/pulls/comments/${comment_id}" >/dev/null 2>&1; then
      warn "comment not found: ${comment_id}"
      failed=$((failed + 1))
      continue
    fi

    if [[ "$dry_run" == "1" ]]; then
      log "dry-run reply comment_id=${comment_id} body=${body}"
      ok=$((ok + 1))
      continue
    fi

    if gh api "repos/${repo}/pulls/comments/${comment_id}/replies" -f body="$body" >/dev/null 2>&1; then
      log "applied reply comment_id=${comment_id}"
      ok=$((ok + 1))
    else
      warn "failed to apply reply comment_id=${comment_id}"
      failed=$((failed + 1))
    fi
  done <"$parsed"

  rm -f "$parsed"

  log "apply summary: processed=${total} ok=${ok} failed=${failed} dry_run=${dry_run}"
  if [[ "$failed" -gt 0 ]]; then
    exit 5
  fi
}

review_summary() {
  local repo="$1"
  local pr="$2"
  local dir="$3"

  local inline_count issue_count review_count
  inline_count="$(jq 'length' "${dir}/inline-comments.json")"
  issue_count="$(jq 'length' "${dir}/issue-comments.json")"
  review_count="$(jq 'length' "${dir}/reviews.json")"

  log "repo=${repo} pr=${pr}"
  log "inline_comments=${inline_count} issue_comments=${issue_count} reviews=${review_count}"
  log "artifacts=${dir}"
  log "next: bun run flow:pr-comments -- todo --pr ${pr} --repo ${repo}"
}

main() {
  require_cmd gh
  require_cmd jq

  local cmd="${1:-}"
  if [[ -z "$cmd" || "$cmd" == "help" || "$cmd" == "--help" || "$cmd" == "-h" ]]; then
    usage
    exit 0
  fi
  shift || true

  ensure_auth

  local repo=""
  local pr=""
  local comment_id=""
  local body=""
  local apply="0"
  local from_file=""
  local dry_run="0"
  local limit="0"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)
        repo="${2:-}"
        shift 2
        ;;
      --pr)
        pr="${2:-}"
        shift 2
        ;;
      --comment-id)
        comment_id="${2:-}"
        shift 2
        ;;
      --body)
        body="${2:-}"
        shift 2
        ;;
      --apply)
        apply="1"
        shift
        ;;
      --from)
        from_file="${2:-}"
        shift 2
        ;;
      --dry-run)
        dry_run="1"
        shift
        ;;
      --limit)
        limit="${2:-0}"
        shift 2
        ;;
      *)
        fail 2 "Unknown argument: $1"
        ;;
    esac
  done

  if ! [[ "${limit:-0}" =~ ^[0-9]+$ ]]; then
    fail 2 "--limit must be a non-negative integer"
  fi

  [[ -n "$repo" ]] || repo="$(infer_repo)"

  case "$cmd" in
    review)
      [[ -n "$pr" ]] || pr="$(infer_pr_number "$repo")"
      local dir
      dir="$(fetch_artifacts "$repo" "$pr")"
      generate_todo "$repo" "$pr"
      review_summary "$repo" "$pr" "$dir"
      ;;
    fetch)
      [[ -n "$pr" ]] || pr="$(infer_pr_number "$repo")"
      dir="$(fetch_artifacts "$repo" "$pr")"
      log "artifacts fetched: ${dir}"
      ;;
    todo)
      [[ -n "$pr" ]] || pr="$(infer_pr_number "$repo")"
      generate_todo "$repo" "$pr"
      ;;
    reply)
      if [[ "$apply" == "1" ]]; then
        [[ -n "$from_file" ]] || fail 2 "--from is required with --apply"
        apply_replies "$repo" "$from_file" "$dry_run" "$limit"
      else
        reply_single "$repo" "$comment_id" "$body"
      fi
      ;;
    *)
      fail 2 "Unknown subcommand: ${cmd}"
      ;;
  esac
}

main "$@"
