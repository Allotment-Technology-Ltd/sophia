#!/bin/bash
# scripts/migrate-to-europe-west2.sh
#
# One-time migration script to consolidate all Sophia GCP resources into
# europe-west2 (London) and eliminate region drift.
#
# Current state (before running this):
#   - Cloud Run (app):   us-central1   ← live — usesophia.app points here
#   - Database (GCE VM): europe-west2-b ← already correct
#   - VPC connector:     europe-west1  ← wrong region for DB
#   - Artifact Registry: europe-west1  ← app image stored here
#   - Ingest registry:   europe-west2  ← already correct
#
# After running this:
#   - Cloud Run (app):   europe-west2  ← co-located with DB, uses VPC
#   - Database (GCE VM): europe-west2-b ← unchanged
#   - VPC connector:     europe-west2  ← new connector, same CIDR
#   - Artifact Registry: europe-west2  ← unified repository
#
# USAGE:
#   chmod +x scripts/migrate-to-europe-west2.sh
#   ./scripts/migrate-to-europe-west2.sh
#
# PREREQUISITES:
#   - gcloud CLI authenticated (gcloud auth login)
#   - gcloud project set: gcloud config set project sophia-488807
#   - Docker available and gcloud CLI has configure-docker access
#   - pnpm and Node installed (for building the app)
#
# The script is IDEMPOTENT — safe to re-run if it fails partway through.
# Each step checks if work is already done before proceeding.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
TARGET_REGION="europe-west2"
TARGET_ZONE="europe-west2-b"
OLD_REGIONS=("us-central1" "europe-west1")

SERVICE_NAME="sophia"
VPC_CONNECTOR="sophia-connector"
VPC_RANGE="10.8.0.0/28"
DB_INTERNAL_IP="10.154.0.2"
DB_EXTERNAL_IP="35.246.25.125"

REGISTRY="${TARGET_REGION}-docker.pkg.dev"
REPOSITORY="sophia"
APP_IMAGE="${REGISTRY}/${PROJECT_ID}/${REPOSITORY}/app"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}  $1${NC}"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║      SOPHIA — Region Consolidation to europe-west2            ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Project:        $PROJECT_ID"
echo "  Target region:  $TARGET_REGION"
echo "  DB internal IP: $DB_INTERNAL_IP (accessed via VPC connector)"
echo ""
echo -e "${YELLOW}This script migrates the live Cloud Run service from us-central1 to"
echo -e "europe-west2, co-locating it with the SurrealDB GCE VM.${NC}"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# ─── Step 0: Pre-flight checks ────────────────────────────────────────────────
step "0. Pre-flight checks"

if ! command -v gcloud &>/dev/null; then
  fail "gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
fi
if ! command -v docker &>/dev/null; then
  fail "docker not found. Install Docker Desktop or Docker Engine."
fi

gcloud config set project "$PROJECT_ID" --quiet
ok "gcloud project set to $PROJECT_ID"

# Check DB VM is up
DB_STATUS=$(gcloud compute instances describe sophia-db \
  --zone="$TARGET_ZONE" \
  --project="$PROJECT_ID" \
  --format="value(status)" 2>/dev/null || echo "NOT_FOUND")

if [ "$DB_STATUS" = "RUNNING" ]; then
  ok "SurrealDB VM (sophia-db) is RUNNING in $TARGET_ZONE"
else
  fail "SurrealDB VM is not RUNNING (status: $DB_STATUS). Abort."
fi

# ─── Step 1: Ensure Artifact Registry repository in europe-west2 ──────────────
step "1. Ensure Artifact Registry repository in $TARGET_REGION"

if gcloud artifacts repositories describe "$REPOSITORY" \
    --location="$TARGET_REGION" \
    --project="$PROJECT_ID" &>/dev/null; then
  ok "Repository '${REPOSITORY}' already exists in $TARGET_REGION"
else
  warn "Repository not found — creating..."
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$TARGET_REGION" \
    --description="Sophia container images — app and ingestion jobs" \
    --project="$PROJECT_ID"
  ok "Repository created in $TARGET_REGION"
fi

# ─── Step 2: Build and push app image to europe-west2 registry ────────────────
step "2. Build and push app image to $TARGET_REGION registry"

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "migration-$(date +%Y%m%d)")
info "Image tag: $GIT_SHA"

gcloud auth configure-docker "$REGISTRY" --quiet

pnpm build
ok "App built successfully"

docker build --no-cache --pull \
  -t "${APP_IMAGE}:${GIT_SHA}" \
  -t "${APP_IMAGE}:latest" \
  .

docker push "${APP_IMAGE}:${GIT_SHA}"
docker push "${APP_IMAGE}:latest"
ok "Image pushed to ${APP_IMAGE}:${GIT_SHA}"

# ─── Step 3: Create VPC connector in europe-west2 ─────────────────────────────
step "3. Create VPC connector '${VPC_CONNECTOR}' in $TARGET_REGION"

CONNECTOR_STATUS=$(gcloud compute networks vpc-access connectors describe \
  "$VPC_CONNECTOR" \
  --region="$TARGET_REGION" \
  --project="$PROJECT_ID" \
  --format="value(state)" 2>/dev/null || echo "NOT_FOUND")

if [ "$CONNECTOR_STATUS" = "READY" ]; then
  ok "VPC connector already READY in $TARGET_REGION"
elif [ "$CONNECTOR_STATUS" = "NOT_FOUND" ]; then
  warn "Creating VPC connector in $TARGET_REGION (takes ~2 minutes)..."
  gcloud compute networks vpc-access connectors create "$VPC_CONNECTOR" \
    --region="$TARGET_REGION" \
    --network=default \
    --range="$VPC_RANGE" \
    --project="$PROJECT_ID" \
    --min-instances=2 \
    --max-instances=3
  ok "VPC connector created"
else
  fail "VPC connector is in unexpected state: $CONNECTOR_STATUS. Check manually."
fi

# Verify connectivity from connector's CIDR to DB internal IP
info "VPC connector range: $VPC_RANGE → DB internal: $DB_INTERNAL_IP"
info "Firewall rule 'allow-surrealdb' should allow tcp:8000 from $VPC_RANGE"

# ─── Step 4: Deploy Cloud Run service in europe-west2 ────────────────────────
step "4. Deploy Cloud Run service to $TARGET_REGION"

NEW_SERVICE_EXISTS=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$PROJECT_ID" \
  --format="value(metadata.name)" 2>/dev/null || echo "")

if [ -n "$NEW_SERVICE_EXISTS" ]; then
  warn "Cloud Run service already exists in $TARGET_REGION — updating..."
else
  info "Deploying new Cloud Run service in $TARGET_REGION..."
fi

gcloud run deploy "$SERVICE_NAME" \
  --image="${APP_IMAGE}:${GIT_SHA}" \
  --project="$PROJECT_ID" \
  --region="$TARGET_REGION" \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --vpc-connector="$VPC_CONNECTOR" \
  --vpc-egress=private-ranges-only \
  --set-env-vars="SURREAL_URL=ws://${DB_INTERNAL_IP}:8000/rpc,SURREAL_USER=root,SURREAL_NAMESPACE=sophia,SURREAL_DATABASE=sophia,GCP_LOCATION=${TARGET_REGION},GOOGLE_VERTEX_LOCATION=${TARGET_REGION}" \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest,SURREAL_PASS=surreal-db-pass:latest,VOYAGE_API_KEY=voyage-api-key:latest,GOOGLE_AI_API_KEY=google-ai-api-key:latest"

NEW_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

ok "Cloud Run service deployed at $NEW_URL"

# ─── Step 5: Health check the new service ─────────────────────────────────────
step "5. Health check the new $TARGET_REGION service"

info "Waiting up to 90s for the service to become healthy..."
HEALTH_OK=false
for i in $(seq 1 18); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${NEW_URL}/api/health" || echo "000")
  echo "  Attempt $i: HTTP $STATUS"
  if [ "$STATUS" = "200" ]; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_OK" = true ]; then
  ok "Health check passed at ${NEW_URL}/api/health"
else
  warn "Health check returned non-200 — check logs before proceeding:"
  info "  gcloud run services logs tail $SERVICE_NAME --region=$TARGET_REGION --project=$PROJECT_ID"
  echo ""
  read -p "Continue with cleanup anyway? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { warn "Aborting — old us-central1 service left intact."; exit 1; }
fi

# ─── Step 6: Update firewall to restrict DB access ───────────────────────────
step "6. Harden firewall — restrict SurrealDB to VPC connector CIDR only"

CURRENT_RANGES=$(gcloud compute firewall-rules describe allow-surrealdb \
  --project="$PROJECT_ID" \
  --format="value(sourceRanges)" 2>/dev/null || echo "NOT_FOUND")

if [ "$CURRENT_RANGES" = "NOT_FOUND" ]; then
  warn "Firewall rule 'allow-surrealdb' not found — skipping (Pulumi will create it)"
elif echo "$CURRENT_RANGES" | grep -q "0.0.0.0/0"; then
  warn "Current rule allows 0.0.0.0/0 — updating to VPC connector CIDR only..."
  gcloud compute firewall-rules update allow-surrealdb \
    --source-ranges="$VPC_RANGE" \
    --project="$PROJECT_ID"
  ok "Firewall rule restricted to $VPC_RANGE"
else
  ok "Firewall rule already restricted (no 0.0.0.0/0)"
fi

# ─── Step 7: Domain information ───────────────────────────────────────────────
step "7. Domain routing — action required"

echo ""
echo -e "${BOLD}usesophia.app is currently pointing to the us-central1 service.${NC}"
echo ""
echo "To route traffic to the new europe-west2 service:"
echo ""
echo "  Option A — Cloud Run domain mapping (recommended):"
info "  gcloud run domain-mappings create \\"
info "    --service=$SERVICE_NAME \\"
info "    --domain=usesophia.app \\"
info "    --region=$TARGET_REGION \\"
info "    --project=$PROJECT_ID"
echo ""
echo "  Option B — External load balancer + Cloud Armor (production hardening):"
info "  See docs/CLOUD-DEPLOYMENT.md for full load balancer setup."
echo ""
echo "  Option C — Manual DNS:"
info "  Point usesophia.app CNAME → ghs.googlehosted.com"
info "  (Cloud Run managed cert is provisioned automatically)"
echo ""

# ─── Step 8: Remove old resources ─────────────────────────────────────────────
step "8. Clean up old region resources"

echo ""
read -p "Delete old Cloud Run service in us-central1? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  OLD_SVC=$(gcloud run services describe "$SERVICE_NAME" \
    --region="us-central1" \
    --project="$PROJECT_ID" \
    --format="value(metadata.name)" 2>/dev/null || echo "")
  if [ -n "$OLD_SVC" ]; then
    gcloud run services delete "$SERVICE_NAME" \
      --region="us-central1" \
      --project="$PROJECT_ID" \
      --quiet
    ok "Deleted Cloud Run service from us-central1"
  else
    info "No Cloud Run service found in us-central1 — skipping"
  fi
else
  warn "Skipping us-central1 cleanup — remember to delete it later"
  info "gcloud run services delete $SERVICE_NAME --region=us-central1 --project=$PROJECT_ID"
fi

echo ""
read -p "Delete old VPC connector in europe-west1? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  OLD_CONNECTOR=$(gcloud compute networks vpc-access connectors describe \
    "$VPC_CONNECTOR" \
    --region="europe-west1" \
    --project="$PROJECT_ID" \
    --format="value(name)" 2>/dev/null || echo "")
  if [ -n "$OLD_CONNECTOR" ]; then
    gcloud compute networks vpc-access connectors delete "$VPC_CONNECTOR" \
      --region="europe-west1" \
      --project="$PROJECT_ID" \
      --quiet
    ok "Deleted VPC connector from europe-west1"
  else
    info "No VPC connector found in europe-west1 — skipping"
  fi
else
  warn "Skipping europe-west1 VPC connector cleanup"
  info "gcloud compute networks vpc-access connectors delete $VPC_CONNECTOR --region=europe-west1 --project=$PROJECT_ID"
fi

# Clean up europe-west1 Artifact Registry (app images were stored there)
echo ""
read -p "Delete app images from europe-west1 Artifact Registry? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  OLD_REPO=$(gcloud artifacts repositories describe "$REPOSITORY" \
    --location="europe-west1" \
    --project="$PROJECT_ID" \
    --format="value(name)" 2>/dev/null || echo "")
  if [ -n "$OLD_REPO" ]; then
    warn "Deleting entire 'sophia' repository from europe-west1..."
    gcloud artifacts repositories delete "$REPOSITORY" \
      --location="europe-west1" \
      --project="$PROJECT_ID" \
      --quiet
    ok "Deleted europe-west1 Artifact Registry repository"
  else
    info "No 'sophia' repository found in europe-west1 — skipping"
  fi
else
  warn "Skipping europe-west1 Artifact Registry cleanup"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                    Migration Complete ✓                         ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  New Cloud Run service: $NEW_URL"
echo "  Region:                $TARGET_REGION"
echo "  DB internal IP:        $DB_INTERNAL_IP (via VPC, no external traffic)"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "  1. Update DNS / domain mapping for usesophia.app → $TARGET_REGION (see Step 7 above)"
echo "  2. Run: cd infra && pulumi stack init production && pulumi up"
echo "     (imports all resources into Pulumi state for ongoing IaC management)"
echo "  3. Add PULUMI_ACCESS_TOKEN GitHub secret for automated infra deployments"
echo "  4. Verify: curl https://usesophia.app/api/health"
echo ""
