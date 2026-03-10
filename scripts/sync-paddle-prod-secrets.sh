#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is not set and gcloud project is unavailable." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

VARS=(
  "PADDLE_API_KEY_PRODUCTION"
  "PADDLE_WEBHOOK_SECRET_PRODUCTION"
  "PADDLE_PRICE_PRO_GBP_PRODUCTION"
  "PADDLE_PRICE_PRO_USD_PRODUCTION"
  "PADDLE_PRICE_PREMIUM_GBP_PRODUCTION"
  "PADDLE_PRICE_PREMIUM_USD_PRODUCTION"
  "PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION"
  "PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION"
  "PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION"
  "PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION"
)

for key in "${VARS[@]}"; do
  value="${!key:-}"
  if [[ -z "${value}" ]]; then
    echo "Missing required value in ${ENV_FILE}: ${key}" >&2
    exit 1
  fi
done

for key in "${VARS[@]}"; do
  value="${!key}"
  if ! gcloud secrets describe "${key}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    echo "[create] ${key}"
    gcloud secrets create "${key}" \
      --project "${PROJECT_ID}" \
      --replication-policy="automatic" >/dev/null
  fi

  echo "[update] ${key}"
  printf '%s' "${value}" | gcloud secrets versions add "${key}" \
    --project "${PROJECT_ID}" \
    --data-file=- >/dev/null
done

echo "Synced Paddle production secrets to project: ${PROJECT_ID}"
