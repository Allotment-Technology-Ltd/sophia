#!/usr/bin/env bash
set -euo pipefail
# Helper to fetch or tail logs related to sophia
# Usage: ./scripts/logs.sh [local|cloud]
MODE=${1:-local}

if [[ "$MODE" = "local" ]]; then
  echo "Local logs: start dev servers in foreground to see logs (pnpm run dev)"
  echo "For ingestion scripts, run them directly with tsx and watch stdout"
fi

if [[ "$MODE" = "cloud" ]]; then
  echo "Cloud logs depend on provider. Examples:"
  echo "- GCP: use 'gcloud logging read' or Cloud Logging UI"
  echo "- Pulumi failures are visible in the Pulumi console and via CLI 'pulumi logs' (if supported)"
fi
