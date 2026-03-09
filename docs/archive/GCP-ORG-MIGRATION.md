# GCP Project Organization Migration Runbook

**Date**: 3 March 2026  
**Project**: sophia-488807  
**From**: adam.boon1984@googlemail.com (personal account)  
**To**: admin@usesophia.app (organization account)  
**Downtime Window**: Extended (several hours for thorough testing)

## Overview

This runbook guides the transfer of the `sophia-488807` GCP project from a personal account to the usesophia.app organization. The project ID remains unchanged, minimizing configuration updates. All data (SurrealDB, Firestore) will be migrated.

## Pre-Migration Checklist

- [ ] Read entire runbook before starting
- [ ] Schedule maintenance window (inform users if applicable)
- [ ] Verify access to both GCP accounts
- [ ] Verify organization admin rights on admin@usesophia.app
- [ ] Confirm billing account ID for organization
- [ ] Create backups (see Phase 1)

## Phase 1: Pre-Migration Backup

### 1.1 Export IAM Policy

```bash
# Authenticate as current account
gcloud auth login adam.boon1984@googlemail.com
gcloud config set project sophia-488807

# Export current IAM policy
gcloud projects get-iam-policy sophia-488807 \
  --format=yaml > data/migration/iam-backup-$(date +%Y%m%d).yaml

# Export service account list
gcloud iam service-accounts list \
  --project=sophia-488807 \
  --format=json > data/migration/service-accounts-backup-$(date +%Y%m%d).json
```

### 1.2 Export Secret Manager Inventory

```bash
# List all secrets
gcloud secrets list \
  --project=sophia-488807 \
  --format=json > data/migration/secrets-inventory-$(date +%Y%m%d).json

# Document secret IAM bindings
for secret in anthropic-api-key voyage-api-key google-ai-api-key surreal-db-pass firebase-api-key firebase-auth-domain admin-uids; do
  echo "=== $secret ===" >> data/migration/secret-iam-$(date +%Y%m%d).txt
  gcloud secrets get-iam-policy $secret \
    --project=sophia-488807 \
    --format=yaml >> data/migration/secret-iam-$(date +%Y%m%d).txt 2>&1
done
```

### 1.3 Backup SurrealDB Data

```bash
# Ensure SurrealDB VM is running
gcloud compute instances describe sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807

# Run database backup script
npx tsx --env-file=.env scripts/db-backup.ts

# Verify backup file created in data/backups/
ls -lh data/backups/ | tail -5
```

### 1.4 Export Firestore Data

```bash
# Create GCS bucket for Firestore export (if doesn't exist)
gsutil mb -p sophia-488807 -l europe-west2 gs://sophia-firestore-backups 2>/dev/null || true

# Export Firestore
gcloud firestore export gs://sophia-firestore-backups/$(date +%Y%m%d) \
  --project=sophia-488807

# Verify export
gsutil ls -lh gs://sophia-firestore-backups/
```

### 1.5 Backup Pulumi State

```bash
cd infra

# Export Pulumi stack state
pulumi stack export --file ../data/migration/pulumi-state-backup-$(date +%Y%m%d).json

# Verify export
ls -lh ../data/migration/pulumi-state-backup-*.json
```

### 1.6 Document Current State

```bash
# Cloud Run services
gcloud run services list \
  --project=sophia-488807 \
  --platform=managed \
  --format=json > data/migration/cloudrun-services-$(date +%Y%m%d).json

# Cloud Run jobs
gcloud run jobs list \
  --project=sophia-488807 \
  --format=json > data/migration/cloudrun-jobs-$(date +%Y%m%d).json

# Compute instances
gcloud compute instances list \
  --project=sophia-488807 \
  --format=json > data/migration/compute-instances-$(date +%Y%m%d).json

# VPC connectors
gcloud compute networks vpc-access connectors list \
  --region=europe-west2 \
  --project=sophia-488807 \
  --format=json > data/migration/vpc-connectors-$(date +%Y%m%d).json

# Artifact Registry repositories
gcloud artifacts repositories list \
  --project=sophia-488807 \
  --format=json > data/migration/artifact-repos-$(date +%Y%m%d).json

# Load balancer components
gcloud compute addresses list \
  --project=sophia-488807 \
  --global \
  --format=json > data/migration/lb-addresses-$(date +%Y%m%d).json

gcloud compute ssl-certificates list \
  --project=sophia-488807 \
  --format=json > data/migration/ssl-certs-$(date +%Y%m%d).json
```

**Checkpoint**: Verify all backup files created successfully before proceeding.

---

## Phase 2: Project Transfer

### 2.1 Get Organization ID

```bash
# Authenticate as organization admin
gcloud auth login admin@usesophia.app

# List organizations
gcloud organizations list

# Note the ORGANIZATION_ID (numeric) for usesophia.app
# Export for use in commands
export ORG_ID=<YOUR_ORG_ID>
```

### 2.2 Get Organization Billing Account

```bash
# List billing accounts accessible to admin@usesophia.app
gcloud billing accounts list

# Note the BILLING_ACCOUNT_ID (format: 012345-67890A-BCDEF0)
export BILLING_ACCOUNT_ID=<YOUR_BILLING_ACCOUNT_ID>
```

### 2.3 Unlink Current Billing

```bash
# Switch back to personal account to unlink billing
gcloud auth login adam.boon1984@googlemail.com
gcloud config set project sophia-488807

# Unlink billing (required before transfer)
gcloud billing projects unlink sophia-488807

# Verify unlinked
gcloud billing projects describe sophia-488807
```

### 2.4 Transfer Project to Organization

**Option A: Via gcloud CLI**

```bash
# Authenticate as organization admin
gcloud auth login admin@usesophia.app

# Transfer project using beta command (only available in beta track)
gcloud beta projects move sophia-488807 --organization=$ORG_ID

# Verify project is now under organization
gcloud projects describe sophia-488807 --format="yaml(parent,projectId)"
```

**If you encounter org policy errors:**

Organization policies may restrict which organizations can export/import projects. You'll see errors like:
```
Constraint `constraints/resourcemanager.allowedExportDestinations` violated
Constraint `constraints/resourcemanager.allowedImportSources` violated
```

To diagnose and fix:

```bash
# Check what policies are blocking the transfer
./scripts/check-org-policies.sh

# If you have admin access to both organizations, you can modify the policies:
# 1. Modify destination org to allow imports from source org
# 2. Modify source org to allow exports to destination org
# See output from check-org-policies.sh for exact commands
```

**Option B: Via GCP Console (if CLI fails)**

1. Go to https://console.cloud.google.com/cloud-resource-manager
2. Authenticate as admin@usesophia.app
3. Find project `sophia-488807`
4. Click on project → Settings
5. Click "Move" button
6. Select your organization as the new parent
7. Confirm move

### 2.5 Relink Organization Billing

```bash
# Link to organization billing account
gcloud billing projects link sophia-488807 --billing-account=$BILLING_ACCOUNT_ID

# Verify linked
gcloud billing projects describe sophia-488807
```

### 2.6 Verify Core Resources Still Accessible

```bash
gcloud config set project sophia-488807

# Check Cloud Run service
gcloud run services describe sophia \
  --region=europe-west2 \
  --project=sophia-488807 \
  --format="value(status.url)"

# Check database VM
gcloud compute instances describe sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --format="value(status)"

# Check Artifact Registry
gcloud artifacts repositories describe sophia \
  --location=europe-west2 \
  --project=sophia-488807
```

**Checkpoint**: All resources should still be accessible. If any command fails, STOP and investigate.

---

## Phase 3: Update IAM and Service Accounts

### 3.1 Grant Admin Access to Organization Account

```bash
# Add admin@usesophia.app as owner
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="user:admin@usesophia.app" \
  --role="roles/owner"

# Verify
gcloud projects get-iam-policy sophia-488807 \
  --flatten="bindings[].members" \
  --filter="bindings.members:admin@usesophia.app"
```

### 3.2 Verify Service Account Permissions

Service accounts transfer automatically with the project. Verify they still have correct roles:

```bash
# Check app service account
gcloud projects get-iam-policy sophia-488807 \
  --flatten="bindings[].members" \
  --filter="bindings.members:sophia-app@sophia-488807.iam.gserviceaccount.com" \
  --format="table(bindings.role)"

# Check ingest service account
gcloud projects get-iam-policy sophia-488807 \
  --flatten="bindings[].members" \
  --filter="bindings.members:sophia-ingest@sophia-488807.iam.gserviceaccount.com" \
  --format="table(bindings.role)"

# Expected roles for sophia-app:
# - roles/secretmanager.secretAccessor
# - roles/aiplatform.user
# - roles/logging.logWriter

# Expected roles for sophia-ingest:
# - roles/secretmanager.secretAccessor
# - roles/aiplatform.user
# - roles/logging.logWriter
```

### 3.3 Verify Secret Manager Access

```bash
# Test service account can access secrets
gcloud secrets get-iam-policy anthropic-api-key \
  --project=sophia-488807 \
  --format="yaml"

# Should see sophia-app@sophia-488807.iam.gserviceaccount.com
# and sophia-ingest@sophia-488807.iam.gserviceaccount.com
# with roles/secretmanager.secretAccessor
```

### 3.4 Remove Personal Account (Optional)

```bash
# Only after verifying everything works!
# You can downgrade to viewer role instead of removing completely:
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="user:adam.boon1984@googlemail.com" \
  --role="roles/viewer"

gcloud projects remove-iam-policy-binding sophia-488807 \
  --member="user:adam.boon1984@googlemail.com" \
  --role="roles/owner"
```

---

## Phase 4: Reconfigure Workload Identity Federation

### 4.1 Get Project Number

```bash
export PROJECT_NUMBER=$(gcloud projects describe sophia-488807 --format="value(projectNumber)")
echo "Project Number: $PROJECT_NUMBER"
```

### 4.2 Create WIF Pool and Provider

```bash
# Create workload identity pool
gcloud iam workload-identity-pools create github-actions \
  --project=sophia-488807 \
  --location=global \
  --display-name="GitHub Actions" \
  --description="Workload Identity pool for GitHub Actions CI/CD"

# Create OIDC provider for GitHub
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --project=sophia-488807 \
  --location=global \
  --workload-identity-pool=github-actions \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-condition="assertion.repository_owner=='YOUR_GITHUB_USERNAME_OR_ORG'"

# Note: Replace YOUR_GITHUB_USERNAME_OR_ORG with actual GitHub owner
```

### 4.3 Create or Verify CI/CD Service Account

```bash
# Check if terraform-sa already exists
gcloud iam service-accounts describe terraform-sa@sophia-488807.iam.gserviceaccount.com \
  --project=sophia-488807 2>/dev/null || \
gcloud iam service-accounts create terraform-sa \
  --project=sophia-488807 \
  --display-name="Terraform/CI Service Account" \
  --description="Service account for GitHub Actions CI/CD pipeline"

export SA_EMAIL="terraform-sa@sophia-488807.iam.gserviceaccount.com"
```

### 4.4 Grant Roles to CI/CD Service Account

```bash
# Artifact Registry writer
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/artifactregistry.writer"

# Cloud Run admin
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.admin"

# Service account user (for Cloud Run)
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"

# Secret manager accessor
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

# Compute admin (for Pulumi infrastructure)
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/compute.admin"

# Service networking admin (for VPC connectors)
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/servicenetworking.networksAdmin"
```

### 4.5 Bind WIF to Service Account

```bash
# Allow GitHub Actions from your repository to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --project=sophia-488807 \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/YOUR_GITHUB_USERNAME/sophia"

# Note: Replace YOUR_GITHUB_USERNAME with actual GitHub username/org
```

### 4.6 Get WIF Provider Resource Name

```bash
export WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github-oidc"
echo "WIF Provider: $WIF_PROVIDER"
echo "WIF Service Account: $SA_EMAIL"

# Save these for GitHub secrets update
```

---

## Phase 5: Update GitHub Repository Secrets

**Manual Steps** (in GitHub web interface):

1. Go to https://github.com/YOUR_USERNAME/sophia/settings/secrets/actions

2. Update or create these secrets:
   - `GCP_PROJECT_ID`: `sophia-488807` (likely unchanged)
   - `WIF_PROVIDER`: Value from Phase 4.6
   - `WIF_SERVICE_ACCOUNT`: `terraform-sa@sophia-488807.iam.gserviceaccount.com`
   - `PULUMI_ACCESS_TOKEN`: (should already exist, no change needed)

3. Verify `.github/workflows/deploy.yml` references these secrets correctly

**Test GitHub Actions**:

```bash
# Trigger a manual workflow run to test WIF authentication
# Do this from GitHub Actions UI with workflow_dispatch
```

---

## Phase 6: Update Local Development Environment

### 6.1 Authenticate with Organization Account

```bash
# Logout of personal account
gcloud auth revoke adam.boon1984@googlemail.com 2>/dev/null || true

# Login with organization account
gcloud auth login admin@usesophia.app

# Set project
gcloud config set project sophia-488807

# Verify
gcloud config list

# Set up Application Default Credentials
gcloud auth application-default login
```

### 6.2 Reconfigure Docker Authentication

```bash
# Configure Docker for Artifact Registry
gcloud auth configure-docker europe-west2-docker.pkg.dev

# Test Docker push access
docker pull hello-world
docker tag hello-world europe-west2-docker.pkg.dev/sophia-488807/sophia/test:migration-test
docker push europe-west2-docker.pkg.dev/sophia-488807/sophia/test:migration-test
docker rmi europe-west2-docker.pkg.dev/sophia-488807/sophia/test:migration-test
gcloud artifacts docker images delete europe-west2-docker.pkg.dev/sophia-488807/sophia/test:migration-test --quiet --delete-tags
```

### 6.3 Update Local .env (if using service account keys)

Most likely you're using Application Default Credentials, so no changes needed to `.env`. Verify:

```bash
cat .env | grep -E 'GCP_PROJECT_ID|GOOGLE_VERTEX_PROJECT'

# Should see:
# GCP_PROJECT_ID=sophia-488807
# GOOGLE_VERTEX_PROJECT=sophia-488807
```

### 6.4 Test Local Scripts

```bash
# Test database connection
npx tsx --env-file=.env scripts/verify-db.ts

# Test embeddings
npx tsx --env-file=.env scripts/test-vertex-embedding.ts

# Test health check
npx tsx --env-file=.env scripts/health-check.ts
```

---

## Phase 7: Verify Pulumi State Access

### 7.1 Test Pulumi Authentication

```bash
cd infra

# Verify Pulumi login
pulumi whoami

# Select production stack
pulumi stack select production

# Run preview (should work without changes)
pulumi preview

# Verify no unexpected changes detected
```

### 7.2 Verify Pulumi Can Manage Resources

```bash
# Test by making a benign change (e.g., updating a tag)
# Then run pulumi up to verify write access

# For now, just verify preview works
pulumi preview --diff
```

---

## Phase 8: Verify Firebase/Firestore Configuration

### 8.1 Access Firebase Console

```bash
# Open Firebase console
open https://console.firebase.google.com/project/sophia-488807
```

- Authenticate as admin@usesophia.app
- Verify project appears
- Check Authentication tab → users visible
- Check Firestore tab → data visible

### 8.2 Verify Firebase IAM

```bash
# Check Firebase admin roles
gcloud projects get-iam-policy sophia-488807 \
  --flatten="bindings[].members" \
  --filter="bindings.members:admin@usesophia.app AND bindings.role:roles/firebase*"

# Verify service accounts have firebase roles
gcloud projects get-iam-policy sophia-488807 \
  --flatten="bindings[].members" \
  --filter="bindings.members:sophia-app@* AND bindings.role:roles/firebase*"
```

### 8.3 Test Firebase Client SDK

```bash
# Test login flow (requires app to be running)
pnpm dev

# In browser: http://localhost:5173
# Click "Sign in with Google"
# Verify authentication works
```

---

## Phase 9: End-to-End System Tests

### 9.1 Test Cloud Run App

```bash
# Check service status
gcloud run services describe sophia \
  --region=europe-west2 \
  --project=sophia-488807 \
  --format="value(status.url,status.conditions)"

# Test health endpoint
curl -i https://usesophia.app

# Test authenticated endpoint (requires Firebase token)
# Use browser to test full user flow
```

### 9.2 Test SurrealDB Connectivity

```bash
# From Cloud Run (check logs)
gcloud run services logs read sophia \
  --region=europe-west2 \
  --project=sophia-488807 \
  --limit=50

# Should see successful database connections
# No VPC connector errors
```

### 9.3 Test Vertex AI Embeddings

```bash
# Check Cloud Run logs for Vertex AI calls
gcloud run services logs read sophia \
  --region=europe-west2 \
  --project=sophia-488807 \
  --limit=50 | grep -i vertex
```

### 9.4 Test Cloud Run Job

```bash
# Execute ingestion job manually
gcloud run jobs execute sophia-ingest \
  --region=europe-west2 \
  --project=sophia-488807 \
  --wait

# Check job execution logs
gcloud run jobs executions logs read \
  --job=sophia-ingest \
  --region=europe-west2 \
  --project=sophia-488807 \
  --limit=100
```

### 9.5 Full User Flow Test

**Manual test in browser**:

1. Go to https://usesophia.app
2. Sign in with Google (using admin@usesophia.app)
3. Ask a philosophical question
4. Verify all three passes generate
5. Check that sources appear
6. View conversation history
7. Sign out

### 9.6 Verify SSL Certificate

```bash
# Check certificate status
gcloud compute ssl-certificates describe sophia-ssl \
  --project=sophia-488807 \
  --global \
  --format="yaml(managed.status,managed.domains)"

# Should be ACTIVE for usesophia.app and www.usesophia.app

# Test HTTPS
curl -I https://usesophia.app | grep "HTTP"
curl -I https://www.usesophia.app | grep "HTTP"

# Both should return HTTP/2 200
```

---

## Phase 10: Documentation Updates

### 10.1 Update References in Documentation

Files to update (see data/migration/docs-update-list.txt for full list):
- `docs/CLOUD-DEPLOYMENT.md`
- `docs/architecture.md`  
- `docs/phase-checklist.md`
- `README.md` (if it references account ownership)

### 10.2 Update Script Defaults

Scripts already use environment variable fallback to `sophia-488807`, so they should work. Verify:

```bash
grep -r "adam.boon1984" scripts/ docs/ || echo "No personal account references found"
```

### 10.3 Update .claude/settings.local.json

Already contains project-specific commands. Just verify they work:

```bash
# Test a command from .claude/settings.local.json
gcloud compute instances describe sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --format="table(name,status,machineType.basename(),networkInterfaces[0].networkIP)"
```

---

## Rollback Plan

If critical issues arise during migration:

### Rollback During Transfer (Phase 2)

1. If project transfer fails or causes issues before IAM updates:
   ```bash
   # Move project back to personal account (requires org admin)
   gcloud projects move sophia-488807 --folder=<ORIGINAL_FOLDER> 
   # or
   gcloud projects move sophia-488807 --organization=<PERSONAL_ORG>
   
   # Relink personal billing
   gcloud billing projects link sophia-488807 --billing-account=<PERSONAL_BILLING>
   ```

### Rollback After IAM Updates (Phase 3+)

If issues arise after IAM/WIF changes:

1. Grant personal account owner role again:
   ```bash
   gcloud projects add-iam-policy-binding sophia-488807 \
     --member="user:adam.boon1984@googlemail.com" \
     --role="roles/owner"
   ```

2. Revert GitHub Actions secrets to old WIF configuration

3. Restore IAM policy from backup:
   ```bash
   gcloud projects set-iam-policy sophia-488807 \
     data/migration/iam-backup-YYYYMMDD.yaml
   ```

### Database Rollback

If data corruption or loss occurs (unlikely with project transfer):

1. Restore SurrealDB from backup:
   ```bash
   npx tsx --env-file=.env scripts/db-restore.ts --file=data/backups/BACKUP_DIR
   ```

2. Restore Firestore from export:
   ```bash
   gcloud firestore import gs://sophia-firestore-backups/YYYYMMDD \
     --project=sophia-488807
   ```

---

## Post-Migration Checklist

- [ ] All Phase 9 tests passing
- [ ] GitHub Actions deployment successful
- [ ] No errors in Cloud Run logs
- [ ] Firebase authentication working
- [ ] Domain SSL certificate ACTIVE
- [ ] Local development environment functional
- [ ] Documentation updated
- [ ] Personal account access removed/downgraded
- [ ] Backup files archived safely
- [ ] Billing alerts configured for organization account
- [ ] Team members (if any) granted appropriate IAM roles

---

## Support & Troubleshooting

### Common Issues

**Issue**: "permission denied" during project transfer  
**Solution**: Verify admin@usesophia.app has Organization Admin role

**Issue**: Cloud Run can't access secrets after transfer  
**Solution**: Verify service accounts still have secretAccessor role on each secret

**Issue**: GitHub Actions authentication fails  
**Solution**: Verify WIF provider and service account binding is correct

**Issue**: Firebase authentication broken  
**Solution**: Verify VITE_FIREBASE_* environment variables still set in Cloud Run

### Getting Help

- GCP Support: https://cloud.google.com/support
- Pulumi Support: https://www.pulumi.com/support/
- Firebase Support: https://firebase.google.com/support

### Migration Completion

Once all tests pass and systems are stable:

1. Archive backup files to long-term storage
2. Document any issues encountered for future reference
3. Update team documentation with new org structure
4. Consider enabling additional org-level features:
   - Organization policies
   - Shared VPC (if expanding to multiple projects)
   - Centralized logging sinks
   - Organization-wide billing budgets

---

**Migration runbook version**: 1.0  
**Last updated**: 3 March 2026
