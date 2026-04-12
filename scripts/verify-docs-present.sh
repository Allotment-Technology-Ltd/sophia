#!/usr/bin/env bash
# Fail if expected documentation paths are missing (e.g. shallow clone or bad .gitignore).
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

# Public slice shipped on main
check "docs/README.md"
check "docs/LOCAL_DOCS.md"
check "docs/sophia/README.md"

# Full Restormel pack: legacy tracked layout OR maintainer gitignored tree
if [[ -f "docs/restormel/meta/linear-config.yml" ]]; then
  check "docs/restormel/meta/milestones.yml"
  check "docs/restormel/README.md"
elif [[ -f "docs/local/restormel/meta/linear-config.yml" ]]; then
  check "docs/local/restormel/meta/milestones.yml"
  check "docs/local/restormel/README.md"
fi

if grep -qE '^docs/\*' .gitignore 2>/dev/null; then
  echo "WARNING: .gitignore contains a broad '^docs/*' rule — Git may stop tracking most of docs/. Remove it if you need the full tree in the repo." >&2
fi

if [[ "$missing" -ne 0 ]]; then
  echo "" >&2
  echo "Fix: refresh the public docs slice from remote main:" >&2
  echo "  git fetch origin && git checkout origin/main -- docs/README.md docs/LOCAL_DOCS.md docs/sophia/" >&2
  echo "For the maintainer-only pack (Restormel, operations, archive), see docs/LOCAL_DOCS.md" >&2
  exit 1
fi

echo "OK: required documentation paths present"
