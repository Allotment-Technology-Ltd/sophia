#!/bin/bash
# Launch all waves in parallel on GCP Cloud Run Jobs
# Usage: ./scripts/run-all-waves-gcp.sh [--build]

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
REGION="europe-west2"
JOB_NAME="sophia-ingest"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BUILD_IMAGE=false
if [ "$1" = "--build" ]; then
    BUILD_IMAGE=true
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         SOPHIA — LAUNCH ALL WAVES (GCP)                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check for required env vars
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Exporting environment variables from .env...${NC}"
    set -a
    source .env
    set +a
fi

# Build image if requested
if [ "$BUILD_IMAGE" = true ]; then
    echo -e "${BLUE}🔨 Building and pushing image...${NC}"
    ./scripts/run-wave-gcp.sh 1 --build
    echo ""
    echo -e "${GREEN}✓ Image ready${NC}"
    echo ""
fi

# Ensure job exists and includes full environment
if ! gcloud run jobs describe "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" &>/dev/null; then
    echo -e "${YELLOW}⚠️  Job doesn't exist yet. Creating with Wave 1...${NC}"
    ./scripts/run-wave-gcp.sh 1
    echo ""
fi

echo -e "${BLUE}🚀 Launching all waves in parallel...${NC}"
echo ""

# Launch Wave 1
echo -e "${YELLOW}[Wave 1] Deploying and executing...${NC}"
gcloud run jobs update "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars WAVE_NUM=1 \
    --quiet

EXEC_1=$(gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="value(metadata.name)")

echo -e "${GREEN}✓ Wave 1 started: $EXEC_1${NC}"
sleep 2

# Launch Wave 2
echo -e "${YELLOW}[Wave 2] Deploying and executing...${NC}"
gcloud run jobs update "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars WAVE_NUM=2 \
    --quiet

EXEC_2=$(gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="value(metadata.name)")

echo -e "${GREEN}✓ Wave 2 started: $EXEC_2${NC}"
sleep 2

# Launch Wave 3
echo -e "${YELLOW}[Wave 3] Deploying and executing...${NC}"
gcloud run jobs update "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars WAVE_NUM=3 \
    --quiet

EXEC_3=$(gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="value(metadata.name)")

echo -e "${GREEN}✓ Wave 3 started: $EXEC_3${NC}"
echo ""

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         ALL WAVES LAUNCHED                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Wave 1: $EXEC_1"
echo "Wave 2: $EXEC_2"
echo "Wave 3: $EXEC_3"
echo ""
echo "Expected completion: 30-60 minutes"
echo ""
echo -e "${BLUE}Monitor all waves:${NC}"
echo "  pnpm monitor:wave"
echo ""
echo "  pnpm monitor:wave:watch"
echo ""
echo -e "${BLUE}Check execution status:${NC}"
echo "  # Wave 1"
echo "  gcloud run jobs executions describe $EXEC_1 --region=$REGION --project=$PROJECT_ID"
echo ""
echo "  # Wave 2"
echo "  gcloud run jobs executions describe $EXEC_2 --region=$REGION --project=$PROJECT_ID"
echo ""
echo "  # Wave 3"
echo "  gcloud run jobs executions describe $EXEC_3 --region=$REGION --project=$PROJECT_ID"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  # All waves"
echo "  gcloud logging read \"resource.labels.job_name=sophia-ingest\" \\"
echo "    --limit=100 --project=$PROJECT_ID --freshness=15m"
echo ""
