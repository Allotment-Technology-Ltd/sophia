#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
ZONE="${SOPHIA_DB_ZONE:-europe-west2-b}"
INSTANCE="${SOPHIA_DB_INSTANCE:-sophia-db}"
LOCAL_PORT="${SOPHIA_DB_LOCAL_PORT:-8800}"
NAMESPACE="${SURREAL_NAMESPACE:-sophia}"
DATABASE="${SURREAL_DATABASE:-sophia}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local retries="${3:-20}"
  local delay="${4:-0.5}"

  for _ in $(seq 1 "$retries"); do
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

require_cmd gcloud
require_cmd pnpm
require_cmd nc

# Ensure gcloud is authenticated before trying tunnel + secret access.
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "[ERROR] gcloud is not authenticated. Run: gcloud auth login" >&2
  exit 1
fi

TUNNEL_PID=""
if nc -z localhost "$LOCAL_PORT" >/dev/null 2>&1; then
  echo "[INFO] Reusing existing tunnel on localhost:${LOCAL_PORT}"
else
  echo "[INFO] Starting IAP tunnel localhost:${LOCAL_PORT} -> ${INSTANCE}:8000"
  gcloud compute ssh "$INSTANCE" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    --tunnel-through-iap \
    -- -L "${LOCAL_PORT}:localhost:8000" -N \
    >/tmp/sophia-prod-db-tunnel.log 2>&1 &

  TUNNEL_PID=$!
  trap 'if [[ -n "${TUNNEL_PID}" ]]; then kill "${TUNNEL_PID}" >/dev/null 2>&1 || true; fi' EXIT INT TERM

  if ! wait_for_port localhost "$LOCAL_PORT"; then
    echo "[ERROR] Tunnel failed to start. Check /tmp/sophia-prod-db-tunnel.log" >&2
    exit 1
  fi
fi

echo "[INFO] Fetching SurrealDB password from Secret Manager"
SURREAL_PASS_VALUE="$(gcloud secrets versions access latest --secret="surreal-db-pass" --project="$PROJECT_ID")"

export SURREAL_URL="http://localhost:${LOCAL_PORT}"
export SURREAL_USER="root"
export SURREAL_PASS="$SURREAL_PASS_VALUE"
export SURREAL_NAMESPACE="$NAMESPACE"
export SURREAL_DATABASE="$DATABASE"

# Load local app keys/config if present.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  source .env.local
fi

echo "[INFO] Starting local app wired to production SurrealDB (${SURREAL_URL})"
exec pnpm run dev
