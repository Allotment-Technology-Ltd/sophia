#!/usr/bin/env bash
# Optional: deploy Cloud Run *service* "sophia-ingest-worker" — same image as "sophia", same 2Gi/1 vCPU/heap as main
# `sophia` (see deploy.yml); lower HTTP concurrency per instance so admin-driven ingest.ts children see less
# request-level contention than on usesophia.app traffic.
#
# Same env/secrets as production web (see .github/workflows/deploy.yml). Invoke after a main deploy when
# IMAGE_REF points at the desired tag/sha.
#
# Required env: IMAGE_REF, NEON_AUTH_BASE_URL, RESTORMEL_GATEWAY_KEY, RESTORMEL_ENVIRONMENT_ID
# RESTORMEL_PROJECT_ID + RESTORMEL_BASE_URL: Secret Manager (--set-secrets)
# Optional: GCP_PROJECT_ID, REGION, SERVICE_NAME (default sophia-ingest-worker)
#
# Step F (Fireworks extraction): Secret Manager IDs must exist and JOB_SA needs roles/secretmanager.secretAccessor on each:
#   EXTRACTION_BASE_URL, EXTRACTION_MODEL, FIREWORKS_API_KEY
# (Or use EXTRACTION_API_KEY instead of FIREWORKS_API_KEY — then edit SECRETS below; see src/lib/server/vertex.ts readExtractionOpenAiCompatibleOverride.)
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-${PROJECT_ID:-sophia-488807}}"
REGION="${REGION:-europe-west2}"
SERVICE_NAME="${INGEST_WORKER_SERVICE_NAME:-sophia-ingest-worker}"
JOB_SA="${WORKER_SERVICE_ACCOUNT:-sophia-app@${PROJECT_ID}.iam.gserviceaccount.com}"

: "${IMAGE_REF:?Set IMAGE_REF to the sophia app image (same as Cloud Run service sophia)}"
: "${NEON_AUTH_BASE_URL:?Set NEON_AUTH_BASE_URL}"
: "${RESTORMEL_GATEWAY_KEY:?Set RESTORMEL_GATEWAY_KEY}"
: "${RESTORMEL_ENVIRONMENT_ID:?Set RESTORMEL_ENVIRONMENT_ID}"

RESTORMEL_KEYS_BASE="${RESTORMEL_KEYS_BASE:-https://restormel.dev/keys/dashboard}"
RESTORMEL_ANALYSE_ROUTE_ID="${RESTORMEL_ANALYSE_ROUTE_ID:-}"
RESTORMEL_VERIFY_ROUTE_ID="${RESTORMEL_VERIFY_ROUTE_ID:-}"

ALLOWED_EMAILS="${ALLOWED_EMAILS:-adam.boon1984@gmail.com,adam.boon1984@googlemail.com,admin@usesophia.app}"
OWNER_EMAILS="${OWNER_EMAILS:-adam.boon1984@gmail.com,adam.boon1984@googlemail.com,admin@usesophia.app}"

# Heap cap for 2Gi container (~75%): clearer OOM than SIGKILL from the platform.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

SECRETS="ANTHROPIC_API_KEY=anthropic-api-key:latest,SURREAL_URL=surreal-db-url:latest,SURREAL_USER=surreal-db-user:latest,SURREAL_PASS=surreal-db-pass:latest,SURREAL_NAMESPACE=surreal-db-namespace:latest,SURREAL_DATABASE=surreal-db-database:latest,VOYAGE_API_KEY=voyage-api-key:latest,GOOGLE_AI_API_KEY=google-ai-api-key:latest,DATABASE_URL=neon-database-url:latest,ADMIN_UIDS=admin-uids:latest,OWNER_UIDS=owner-uids:latest,PADDLE_API_KEY_PRODUCTION=PADDLE_API_KEY_PRODUCTION:latest,PADDLE_WEBHOOK_SECRET_PRODUCTION=PADDLE_WEBHOOK_SECRET_PRODUCTION:latest,PADDLE_PRICE_PRO_GBP_PRODUCTION=PADDLE_PRICE_PRO_GBP_PRODUCTION:latest,PADDLE_PRICE_PRO_USD_PRODUCTION=PADDLE_PRICE_PRO_USD_PRODUCTION:latest,PADDLE_PRICE_PREMIUM_GBP_PRODUCTION=PADDLE_PRICE_PREMIUM_GBP_PRODUCTION:latest,PADDLE_PRICE_PREMIUM_USD_PRODUCTION=PADDLE_PRICE_PREMIUM_USD_PRODUCTION:latest,PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION=PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION:latest,PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION=PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION:latest,PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION=PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION:latest,PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION=PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION:latest,PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION=PADDLE_CLIENT_TOKEN:latest,INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM=INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM:latest,EXTRACTION_BASE_URL=EXTRACTION_BASE_URL:latest,EXTRACTION_MODEL=EXTRACTION_MODEL:latest,FIREWORKS_API_KEY=FIREWORKS_API_KEY:latest,RESTORMEL_PROJECT_ID=RESTORMEL_PROJECT_ID:latest,RESTORMEL_BASE_URL=RESTORMEL_BASE_URL:latest"

ENV_BLOCK="^|^ADMIN_INGEST_RUN_REAL=1|ADMIN_INGEST_MAX_CONCURRENT=3|INGEST_QUEUE_ENABLED=0|SOPHIA_DATA_BACKEND=neon|USE_NEON_AUTH=1|NEON_AUTH_BASE_URL=${NEON_AUTH_BASE_URL}|PUBLIC_NEON_AUTH_URL=${NEON_AUTH_BASE_URL}|GCP_PROJECT_ID=${PROJECT_ID}|GCP_LOCATION=${REGION}|GOOGLE_VERTEX_LOCATION=us-central1|ALLOWED_EMAILS=${ALLOWED_EMAILS}|OWNER_EMAILS=${OWNER_EMAILS}|PADDLE_RUNTIME=production|BYOK_DISABLE_CLOUD_KMS_ENCRYPT=1|RESTORMEL_GATEWAY_KEY=${RESTORMEL_GATEWAY_KEY}|RESTORMEL_ENVIRONMENT_ID=${RESTORMEL_ENVIRONMENT_ID}|RESTORMEL_KEYS_BASE=${RESTORMEL_KEYS_BASE}|RESTORMEL_ANALYSE_ROUTE_ID=${RESTORMEL_ANALYSE_ROUTE_ID}|RESTORMEL_VERIFY_ROUTE_ID=${RESTORMEL_VERIFY_ROUTE_ID}|RESTORMEL_PROJECT_MODEL_REGISTRY_BINDINGS=1|INGEST_NEON_LOG_PERSISTENCE=minimal|INGEST_NEON_ACTIVITY_DEBOUNCE_MS=1500|INGEST_MODEL_TIMEOUT_MS=360000|INGEST_STAGE_EXTRACTION_TIMEOUT_MS=180000|INGEST_WATCHDOG_IDLE_MS=720000|NODE_OPTIONS=${NODE_OPTIONS}"

echo "Deploying Cloud Run service ${SERVICE_NAME} (ingest-heavy sizing, image ${IMAGE_REF})…"

gcloud run deploy "${SERVICE_NAME}" \
	--image="${IMAGE_REF}" \
	--project="${PROJECT_ID}" \
	--region="${REGION}" \
	--allow-unauthenticated \
	--memory=2Gi \
	--cpu=1 \
	--min-instances=0 \
	--max-instances=2 \
	--concurrency=2 \
	--service-account="${JOB_SA}" \
	--set-secrets="${SECRETS}" \
	--set-env-vars="${ENV_BLOCK}"

echo "OK: ${SERVICE_NAME} deployed. URL:"
gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)'
echo "Use this origin for admin ingest sessions to isolate from public web traffic (add OAuth redirect URI for this URL)."
