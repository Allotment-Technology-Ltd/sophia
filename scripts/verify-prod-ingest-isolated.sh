#!/usr/bin/env bash
# Reproduce Cloud Run runtime: prod-only install + ingest module graph smoke test.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

for f in package.json pnpm-lock.yaml pnpm-workspace.yaml packages scripts src tsconfig.json jsconfig.json; do
  cp -R "$ROOT/$f" "$TMP/"
done
# Optional local tarballs (e.g. vendored packages); omit when absent — installs use registry only.
if [[ -d "$ROOT/vendor" ]]; then
  cp -R "$ROOT/vendor" "$TMP/"
fi

cd "$TMP"
pnpm install --prod --frozen-lockfile
pnpm exec tsx scripts/verify-cloud-run-ingest-modules.ts
echo "[verify-prod-ingest-isolated] OK"
