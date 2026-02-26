#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-}"

if [[ -z "$TARGET_BRANCH" ]]; then
  echo "Usage: bun run flow:branch -- <type/short-name>"
  exit 2
fi

if [[ "$TARGET_BRANCH" == "main" ]]; then
  echo "❌ flow:branch: target branch cannot be main"
  exit 2
fi

if ! [[ "$TARGET_BRANCH" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
  echo "❌ flow:branch: invalid branch name '$TARGET_BRANCH'"
  exit 2
fi

WORKTREE_CHANGES=$(git status --porcelain | grep -v '^?? _ctx/review_runs/' || true)
if [[ -n "$WORKTREE_CHANGES" ]]; then
  echo "❌ flow:branch: working tree is not clean"
  echo "Commit/stash your changes before creating a new branch."
  exit 2
fi

if git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
  echo "❌ flow:branch: local branch '$TARGET_BRANCH' already exists"
  exit 2
fi

if git ls-remote --exit-code --heads origin "$TARGET_BRANCH" >/dev/null 2>&1; then
  echo "❌ flow:branch: remote branch '$TARGET_BRANCH' already exists"
  echo "Use: git checkout -b $TARGET_BRANCH --track origin/$TARGET_BRANCH"
  exit 2
fi

echo "▶ flow:branch: syncing main from origin"
git fetch origin main

git checkout main >/dev/null 2>&1 || git checkout main
git reset --hard origin/main

git checkout -b "$TARGET_BRANCH"
echo "✅ flow:branch: created '$TARGET_BRANCH' from origin/main"
