#!/bin/bash
# Run wave ingestion on GCP Cloud Run Jobs
# Usage: ./scripts/run-wave-gcp.sh <wave-number> [--build]
#
# Examples:
#   ./scripts/run-wave-gcp.sh 1           # Run Wave 1 (uses existing image)
#   ./scripts/run-wave-gcp.sh 1 --build   # Rebuild image and run Wave 1
#
# Environment variables (optional):
#   SKIP_SOURCE_IDS   Comma-separated source IDs to skip (e.g. SKIP_SOURCE_IDS=5,6 ./scripts/run-wave-gcp.sh 1)

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
REGION="europe-west2"  # London
JOB_NAME="sophia-ingest"
IMAGE_NAME="sophia-ingest"
REGISTRY="europe-west2-docker.pkg.dev"
REPOSITORY="sophia"
FULL_IMAGE="${REGISTRY}/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:v2-live"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
WAVE_NUM=$1
BUILD_IMAGE=false

if [ -z "$WAVE_NUM" ]; then
    echo -e "${RED}❌ Error: Wave number required${NC}"
    echo "Usage: $0 <wave-number> [--build]"
    echo "Example: $0 1 --build"
    exit 1
fi

if [ "$2" = "--build" ]; then
    BUILD_IMAGE=true
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         SOPHIA — GCP CLOUD RUN JOB                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Wave:     $WAVE_NUM"
echo "Image:    $FULL_IMAGE"
echo ""

# Check for required tools
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

# Check for required env vars
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}❌ ANTHROPIC_API_KEY not set${NC}"
    exit 1
fi

if [ -z "$VOYAGE_API_KEY" ]; then
    echo -e "${RED}❌ VOYAGE_API_KEY not set${NC}"
    exit 1
fi

if [ -z "$GOOGLE_AI_API_KEY" ]; then
    echo -e "${RED}❌ GOOGLE_AI_API_KEY not set${NC}"
    exit 1
fi

if [ -z "$SURREAL_URL" ]; then
    echo -e "${YELLOW}⚠️  SURREAL_URL not set, using default${NC}"
    SURREAL_URL="http://35.246.25.125:8000/rpc"
fi

if [ -z "$SURREAL_PASS" ]; then
    echo -e "${RED}❌ SURREAL_PASS not set${NC}"
    exit 1
fi

# Build and push image if requested
if [ "$BUILD_IMAGE" = true ]; then
    echo -e "${BLUE}🔨 Building Docker image...${NC}"
    
    # Ensure Artifact Registry repository exists
    if ! gcloud artifacts repositories describe "$REPOSITORY" \
        --location="$REGION" \
        --project="$PROJECT_ID" &>/dev/null; then
        
        echo -e "${YELLOW}⚠️  Creating Artifact Registry repository...${NC}"
        gcloud artifacts repositories create "$REPOSITORY" \
            --repository-format=docker \
            --location="$REGION" \
            --project="$PROJECT_ID"
    fi
    
    # Configure Docker auth
    gcloud auth configure-docker "${REGISTRY}" --quiet
    
    # Build multi-platform image
    docker build \
        -f Dockerfile.ingest \
        -t "$FULL_IMAGE" \
        --platform linux/amd64 \
        .
    
    echo -e "${BLUE}📦 Pushing image to Artifact Registry...${NC}"
    docker push "$FULL_IMAGE"
    
    echo -e "${GREEN}✓ Image built and pushed${NC}"
    echo ""
fi

# Check if job exists, create or update
echo -e "${BLUE}🚀 Deploying Cloud Run Job...${NC}"

if gcloud run jobs describe "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" &>/dev/null; then
    
    echo -e "${YELLOW}Updating existing job...${NC}"
    ACTION="update"
else
    echo -e "${YELLOW}Creating new job...${NC}"
    ACTION="create"
fi

gcloud run jobs "$ACTION" "$JOB_NAME" \
    --image "$FULL_IMAGE" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --max-retries 0 \
    --task-timeout 10800 \
    --memory 4Gi \
    --cpu 2 \
    --set-env-vars WAVE_NUM="$WAVE_NUM" \
    --set-env-vars ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    --set-env-vars VOYAGE_API_KEY="$VOYAGE_API_KEY" \
    --set-env-vars GOOGLE_AI_API_KEY="$GOOGLE_AI_API_KEY" \
    --set-env-vars SURREAL_URL="$SURREAL_URL" \
    --set-env-vars SURREAL_USER="root" \
    --set-env-vars SURREAL_PASS="$SURREAL_PASS" \
    --set-env-vars DB_CONNECT_MAX_RETRIES=4 \
    --set-env-vars DB_CONNECT_RETRY_BASE_MS=750 \
    --set-env-vars PHASE_A_CONCURRENCY=2 \
    --set-env-vars GEMINI_CONCURRENCY=1 \
    --set-env-vars SKIP_SOURCE_IDS="${SKIP_SOURCE_IDS:-}"

echo -e "${GREEN}✓ Job deployed${NC}"
echo ""

# Execute the job
echo -e "${BLUE}▶️  Executing Wave $WAVE_NUM ingestion...${NC}"
echo ""

EXECUTION=$(gcloud run jobs execute "$JOB_NAME" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --format="value(metadata.name)")

echo -e "${GREEN}✓ Job started: $EXECUTION${NC}"
echo ""
echo "Monitor logs:"
echo -e "${BLUE}  gcloud run jobs executions logs $EXECUTION --region=$REGION --project=$PROJECT_ID${NC}"
echo ""
echo "Or stream logs:"
echo -e "${BLUE}  gcloud run jobs executions logs $EXECUTION --region=$REGION --project=$PROJECT_ID --follow${NC}"
echo ""
echo "Check status:"
echo -e "${BLUE}  gcloud run jobs executions describe $EXECUTION --region=$REGION --project=$PROJECT_ID${NC}"
