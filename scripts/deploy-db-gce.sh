#!/bin/bash
# Deploy SurrealDB to Google Compute Engine VM
# Phase 3b: Production database deployment
# Cost: ~£4/month (e2-micro + 10GB disk)

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-sophia-production}"
INSTANCE_NAME="sophia-db"
ZONE="europe-west2-b"  # London
MACHINE_TYPE="e2-micro"  # 2 vCPU, 1GB RAM - Free tier eligible
DISK_SIZE="10GB"
SURREAL_VERSION="v2.0.0"
SURREAL_PORT="8000"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "╔══════════════════════════════════════════════════════════╗"
echo "║       SURREALDB GCE VM DEPLOYMENT                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check for required environment variables
if [ -z "$SURREAL_PROD_PASS" ]; then
    echo -e "${RED}❌ Error: SURREAL_PROD_PASS not set${NC}"
    echo "Set it with: export SURREAL_PROD_PASS='your-secure-password'"
    exit 1
fi

if [ -z "$GCP_PROJECT_ID" ]; then
    echo -e "${YELLOW}⚠️  GCP_PROJECT_ID not set, using default project${NC}"
    PROJECT_ID=$(gcloud config get-value project)
fi

echo "Project ID: $PROJECT_ID"
echo "Instance:   $INSTANCE_NAME"
echo "Zone:       $ZONE"
echo "Machine:    $MACHINE_TYPE"
echo ""

# Check if instance already exists
if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
    echo -e "${YELLOW}⚠️  Instance $INSTANCE_NAME already exists${NC}"
    read -p "Do you want to recreate it? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Deleting existing instance..."
        gcloud compute instances delete "$INSTANCE_NAME" \
            --zone="$ZONE" \
            --project="$PROJECT_ID" \
            --quiet
    else
        echo "Keeping existing instance"
        exit 0
    fi
fi

echo -e "${GREEN}Creating GCE instance...${NC}"

# Create startup script
STARTUP_SCRIPT=$(cat <<'EOF'
#!/bin/bash
set -e

echo "Installing SurrealDB..."
curl -sSf https://install.surrealdb.com | sh

# Create systemd service
cat > /etc/systemd/system/surrealdb.service <<SERVICE
[Unit]
Description=SurrealDB Database
After=network.target

[Service]
Type=simple
User=root
ExecStart=/root/.surrealdb/surreal start \
    --bind 0.0.0.0:8000 \
    --user root \
    --pass ${SURREAL_PROD_PASS} \
    --log info \
    file:/var/lib/surrealdb/sophia.db
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

# Create data directory
mkdir -p /var/lib/surrealdb
chmod 700 /var/lib/surrealdb

# Start SurrealDB
systemctl daemon-reload
systemctl enable surrealdb
systemctl start surrealdb

echo "SurrealDB started successfully"
EOF
)

# Create the instance
gcloud compute instances create "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --network-interface=network-tier=PREMIUM,stack-type=IPV4_ONLY,subnet=default \
    --maintenance-policy=MIGRATE \
    --provisioning-model=STANDARD \
    --scopes=https://www.googleapis.com/auth/devstorage.read_only,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/trace.append \
    --tags=surrealdb,http-server \
    --create-disk=auto-delete=yes,boot=yes,device-name="$INSTANCE_NAME",image=projects/ubuntu-os-cloud/global/images/ubuntu-2204-jammy-v20240319,mode=rw,size="$DISK_SIZE",type=pd-standard \
    --no-shielded-secure-boot \
    --shielded-vtpm \
    --shielded-integrity-monitoring \
    --labels=app=sophia,component=database \
    --reservation-affinity=any \
    --metadata="startup-script=$STARTUP_SCRIPT,surreal-pass=$SURREAL_PROD_PASS"

echo -e "${GREEN}✓ Instance created${NC}"
echo ""

# Create firewall rule for SurrealDB
echo "Creating firewall rule..."
if ! gcloud compute firewall-rules describe allow-surrealdb --project="$PROJECT_ID" &>/dev/null; then
    gcloud compute firewall-rules create allow-surrealdb \
        --project="$PROJECT_ID" \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:8000 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=surrealdb \
        --description="Allow SurrealDB access"
    echo -e "${GREEN}✓ Firewall rule created${NC}"
else
    echo -e "${YELLOW}Firewall rule already exists${NC}"
fi

echo ""
echo "Waiting for instance to start (30s)..."
sleep 30

# Get external IP
EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              DEPLOYMENT COMPLETE                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}SurrealDB is running at:${NC}"
echo "  ws://$EXTERNAL_IP:8000/rpc"
echo "  http://$EXTERNAL_IP:8000"
echo ""
echo "Connection details:"
echo "  SURREAL_URL=ws://$EXTERNAL_IP:8000/rpc"
echo "  SURREAL_USER=root"
echo "  SURREAL_PASS=<stored in Secret Manager>"
echo ""
echo "Add to your .env file:"
echo "  SURREAL_URL=ws://$EXTERNAL_IP:8000/rpc"
echo ""
echo "Useful commands:"
echo "  # SSH into instance"
echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "  # Check SurrealDB logs"
echo "  gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID --command='sudo journalctl -u surrealdb -f'"
echo ""
echo "  # Stop instance (to save costs)"
echo "  gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "  # Start instance"
echo "  gcloud compute instances start $INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "Monthly cost estimate: ~£4 (covered by £200 credits)"
echo ""
