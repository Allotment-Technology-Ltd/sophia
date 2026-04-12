#!/usr/bin/env bash
# Commit all staged changes and push to origin/main (after rebase).
# Use when you have many files staged (e.g. docs) and want them on main without
# remembering the exact sequence. Run from repo root.
#
#   pnpm git:sync-main -- "chore: your message here"
#   COMMIT_MSG="fix: foo" pnpm git:sync-main
#
set -euo pipefail
cd "$(dirname "$0")/.."

if git diff --cached --quiet; then
  echo "Nothing staged. Stage files first (git add …) or run: git restore --staged ." >&2
  exit 1
fi

MSG="${1:-${COMMIT_MSG:-}}"
if [[ -z "${MSG// }" ]]; then
  echo "Usage: $0 \"commit message\"" >&2
  echo "   or: COMMIT_MSG=\"…\" $0" >&2
  exit 1
fi

git fetch origin
git pull origin main --rebase

git commit -m "$MSG"
git push origin main

echo "OK: pushed to origin/main"
