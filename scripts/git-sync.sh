#!/usr/bin/env bash
set -euo pipefail
# Sync current branch with origin/main (sophia)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" = "main" || "$BRANCH" = "master" ]]; then
  echo "You are on main; create a feature branch before syncing."; exit 1
fi

git fetch origin
git rebase origin/main

# Run basic checks
if command -v pnpm >/dev/null 2>&1; then
  pnpm run check || { echo "Checks failed — aborting rebase"; git rebase --abort; exit 1; }
fi

git push --force-with-lease origin "$BRANCH"
