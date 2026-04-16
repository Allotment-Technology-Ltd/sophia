#!/usr/bin/env bash
# Emit export lines for Sophia EXTRACTION_* pointing at a Fireworks on-demand deployment.
# Usage:
#   bash scripts/fireworks-extraction-eval-env.sh accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>
#
# Requires FIREWORKS_API_KEY in the environment (or .env loaded by your shell).

set -euo pipefail

DEPLOYMENT_ID="${1:-}"
if [[ -z "$DEPLOYMENT_ID" || "$DEPLOYMENT_ID" == -* ]]; then
	echo "Usage: bash scripts/fireworks-extraction-eval-env.sh accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>" >&2
	exit 2
fi

if [[ "$DEPLOYMENT_ID" != accounts/* ]]; then
	echo "Error: deployment id must look like accounts/<id>/deployments/<name>" >&2
	exit 2
fi

KEY="${EXTRACTION_API_KEY:-${FIREWORKS_API_KEY:-}}"
if [[ -z "$KEY" ]]; then
	echo "Warning: neither EXTRACTION_API_KEY nor FIREWORKS_API_KEY is set; paste your key after copying." >&2
fi

echo "# Fireworks OpenAI-compatible extraction (paste into shell or .env.local)"
echo "export EXTRACTION_BASE_URL=\"https://api.fireworks.ai/inference/v1\""
echo "export EXTRACTION_MODEL=\"${DEPLOYMENT_ID}\""
if [[ -n "${FIREWORKS_API_KEY:-}" ]]; then
	echo "export EXTRACTION_API_KEY=\"\${FIREWORKS_API_KEY}\""
elif [[ -n "${EXTRACTION_API_KEY:-}" ]]; then
	echo "export EXTRACTION_API_KEY=\"\${EXTRACTION_API_KEY}\""
else
	echo "# export EXTRACTION_API_KEY=\"fw_…\""
fi
echo "# pnpm ops:eval-extraction-holdout-openai-compatible -- --jsonl data/phase1-training-export/golden_holdout.jsonl --limit 200 --out data/phase1-training-export/eval-fireworks.json"
