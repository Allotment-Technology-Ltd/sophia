#!/usr/bin/env bash
set -euo pipefail
# Start local development environment for sophia
# Usage: ./scripts/dev.sh [--with-infra]
# --with-infra: print pointer to production deployment docs
WITH_INFRA=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-infra) WITH_INFRA=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$WITH_INFRA" = true ]]; then
  echo "Production Railway runbook: docs/sophia/deployment-railway.md"
  echo "Legacy GCP archive: docs/local/operations/gcp-infrastructure.md"
  echo "Deploy workflow: .github/workflows/deploy.yml"
fi

echo "Starting SvelteKit dev server"
pnpm run dev
