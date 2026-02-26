# CLI Flow (mandatory)

1. Create/switch branch: `git checkout -b <type/short-name>`.
2. Stage changes: `git add <files>`.
3. Commit only via wrapper: `bun run flow:commit -- -m "type(scope): message"`.
4. Run pre-PR gate: `bun run flow:prepr`.
5. Push branch: `git push -u origin <branch>`.
6. Create PR via wrapper: `bun run flow:pr -- "PR title" "PR body" --base main`.
7. Wait for checks: `gh pr checks <number> --watch`.
8. Address feedback, repeat steps 2-7 if needed.
9. Merge with GitHub CLI when approved: `gh pr merge <number> --squash --delete-branch`.
10. Sync local main: `git checkout main && git pull --ff-only`.
