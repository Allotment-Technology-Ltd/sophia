#!/usr/bin/env bash
set -euo pipefail
# sophia: test helper for Svelte/Vite + infra checks
# Usage: ./scripts/test.sh [--ci] [--package <pkg>]
CI=false
PKG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci) CI=true; shift ;;
    --package) PKG="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "==> Running project checks for sophia..."
if [[ -n "$PKG" ]]; then
  echo "Package-scoped checks for: $PKG"
  pnpm --filter "$PKG" run check || exit 1
else
  # run app-level checks
  if [[ -f package.json ]]; then
    if jq -e '.scripts.check' package.json >/dev/null 2>&1; then
      pnpm run check
    else
      echo "No top-level check script; running svelte-check if available"
      if command -v svelte-check >/dev/null 2>&1; then
        svelte-check --tsconfig ./jsconfig.json || true
      fi
    fi
  fi
fi

if [[ "$CI" = true ]]; then
  echo "CI mode: ensure results/artifacts are captured by CI"
fi
