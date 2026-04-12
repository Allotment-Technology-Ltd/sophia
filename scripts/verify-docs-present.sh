#!/usr/bin/env bash
# Fail if expected tracked docs are missing (e.g. after a shallow clone or a bad .gitignore).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

missing=0
check() {
  if [[ ! -f "$1" ]]; then
    echo "MISSING: $1" >&2
    missing=1
  fi
}

check "docs/restormel/meta/linear-config.yml"
check "docs/restormel/meta/milestones.yml"
check "docs/restormel/README.md"
check "docs/README.md"

if grep -qE '^docs/\*' .gitignore 2>/dev/null; then
  echo "WARNING: .gitignore contains a broad '^docs/*' rule — Git may stop tracking most of docs/. Remove it if you need the full tree in the repo." >&2
fi

if [[ "$missing" -ne 0 ]]; then
  echo "" >&2
  echo "Fix: from repo root run:" >&2
  echo "  git fetch origin && git checkout origin/main -- docs/" >&2
  echo "Or reset to main: git pull origin main" >&2
  exit 1
fi

echo "OK: core docs paths present under docs/"
