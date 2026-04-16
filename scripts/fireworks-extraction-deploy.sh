#!/usr/bin/env bash
# Helper: upload merged HF weights to Fireworks and create a cost-biased on-demand deployment.
# Prereqs: firectl installed, `firectl signin`, FIREWORKS_API_KEY set.
#
# Usage:
#   bash scripts/fireworks-extraction-deploy.sh <MODEL_SLUG> /path/to/merged-hf-dir
#
# MODEL_SLUG must be only lowercase a-z, 0-9, and hyphens (no `accounts/` path — see
# https://docs.fireworks.ai/tools-sdks/firectl/commands/model-create ).
#
# This script does NOT upload LoRA-only bundles; use firectl directly with --base-model per Fireworks docs.
# See docs/sophia/extraction-fireworks-deploy.md

set -euo pipefail

MODEL_SLUG="${1:-}"
WEIGHTS_DIR="${2:-}"

if [[ -z "$MODEL_SLUG" || -z "$WEIGHTS_DIR" ]]; then
	echo "Usage: bash scripts/fireworks-extraction-deploy.sh <MODEL_SLUG> /path/to/merged-hf-directory" >&2
	echo "Example: bash scripts/fireworks-extraction-deploy.sh sophia-extract-m7b-ft ./data/phase1-training-export/merged-bfl6-hf" >&2
	exit 2
fi

if [[ "$MODEL_SLUG" == *"/"* ]]; then
	echo "Error: use a short model slug only (e.g. sophia-extract-m7b-ft), not accounts/.../models/..." >&2
	exit 1
fi

if [[ ! "$MODEL_SLUG" =~ ^[a-z0-9-]+$ ]]; then
	echo "Error: model slug must be only lowercase a-z, 0-9, and hyphens: ${MODEL_SLUG}" >&2
	exit 1
fi

if ! command -v firectl >/dev/null 2>&1; then
	echo "Error: firectl not found. Install: https://docs.fireworks.ai/getting-started/ondemand-quickstart" >&2
	exit 1
fi

if [[ ! -f "${WEIGHTS_DIR}/config.json" ]]; then
	echo "Error: ${WEIGHTS_DIR}/config.json not found — expected a Hugging Face model directory." >&2
	exit 1
fi

echo "==> Uploading model ${MODEL_SLUG} from ${WEIGHTS_DIR}"
firectl model create "${MODEL_SLUG}" "${WEIGHTS_DIR}/"

echo "==> Waiting for model READY (poll with: firectl model get ${MODEL_SLUG})"
echo "==> Creating deployment (no --deployment-shape: custom models; scale-to-zero friendly)"
firectl deployment create "${MODEL_SLUG}" \
	--accelerator-type NVIDIA_A100_80GB \
	--accelerator-count 1 \
	--min-replica-count 0 \
	--max-replica-count 1 \
	--scale-to-zero-window 5m \
	--scale-down-window 5m \
	--scale-up-window 30s \
	--wait

echo ""
echo "Next: copy the deployment Name from the output above, then:"
echo "  bash scripts/fireworks-extraction-eval-env.sh accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>"
