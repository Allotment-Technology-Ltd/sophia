#!/usr/bin/env bash
# Commit all staged changes and push to origin/main.
# Order: fetch → commit (staged) → rebase onto origin/main → push.
# Avoids `git pull` "divergent branches" / pull.rebase config issues.
#
# From repo root (use ONE of these — see package.json for script name):
#   pnpm run git:sync-main -- "chore: your message"
#   bash scripts/git-sync-and-push-main.sh "chore: your message"
#   COMMIT_MSG="fix: foo" bash scripts/git-sync-and-push-main.sh
#
# Do NOT put shell comments on the same line as `git add` (can confuse git/pathspec).
#
set -euo pipefail
cd "$(dirname "$0")/.."

if git diff --cached --quiet; then
  echo "Nothing staged. Stage files first: git add -A" >&2
  exit 1
fi

MSG="${1:-${COMMIT_MSG:-}}"
if [[ -z "${MSG// }" ]]; then
  echo "Usage: bash scripts/git-sync-and-push-main.sh \"commit message\"" >&2
  echo "   or: pnpm run git:sync-main -- \"commit message\"" >&2
  exit 1
fi

git fetch origin

git commit -m "$MSG"

git rebase origin/main

git push origin main

echo "OK: pushed to origin/main"
