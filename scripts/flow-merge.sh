#!/usr/bin/env bash
set -euo pipefail

PR_REF="${1:-}"
MERGE_MODE="${2:---squash}"

if [[ -z "$PR_REF" ]]; then
  echo "Usage: bun run flow:merge -- <pr-number|url|branch> [--squash|--merge|--rebase]"
  exit 2
fi

if [[ "$MERGE_MODE" != "--squash" && "$MERGE_MODE" != "--merge" && "$MERGE_MODE" != "--rebase" ]]; then
  echo "❌ flow:merge: invalid merge mode '$MERGE_MODE'"
  echo "Allowed: --squash | --merge | --rebase"
  exit 2
fi

WORKTREE_CHANGES=$(git status --porcelain | grep -v '^?? _ctx/review_runs/' || true)
if [[ -n "$WORKTREE_CHANGES" ]]; then
  echo "❌ flow:merge: working tree is not clean"
  echo "Commit/stash your changes before merging."
  exit 2
fi

gh auth status >/dev/null

echo "▶ flow:merge: verifying required checks"
if ! gh pr checks "$PR_REF" --required >/dev/null; then
  echo "❌ flow:merge: required checks are not passing yet"
  echo "Run: gh pr checks $PR_REF --watch"
  exit 1
fi

echo "▶ flow:merge: merging PR ($MERGE_MODE)"
gh pr merge "$PR_REF" "$MERGE_MODE" --delete-branch

echo "▶ flow:merge: syncing local main"
git fetch origin main
git checkout main
if ! git merge --ff-only origin/main; then
  echo "❌ flow:merge: could not fast-forward local main"
  echo "Run: git reset --hard origin/main (only if safe)"
  exit 1
fi

echo "✅ flow:merge: main is updated"
