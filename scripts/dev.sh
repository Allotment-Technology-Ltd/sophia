#!/usr/bin/env bash
set -euo pipefail
# Start local development environment for sophia
# Usage: ./scripts/dev.sh [--with-infra]
WITH_INFRA=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-infra) WITH_INFRA=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$WITH_INFRA" = true && -d infra ]]; then
  echo "Starting infra preview (Pulumi) in a separate terminal:"
  echo "  cd infra && pulumi preview --stack production"
fi

echo "Starting SvelteKit dev server"
pnpm run dev
