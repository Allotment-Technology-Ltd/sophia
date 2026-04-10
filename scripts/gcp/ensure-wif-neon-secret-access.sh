#!/usr/bin/env bash
# Idempotent: grant the GitHub Actions deploy SA read access to neon-database-url
# (required for pnpm db:migrate:ci in deploy.yml).
#
# Run once from a machine with gcloud admin (owner/editor):
#   GCP_PROJECT_ID=sophia-488807 WIF_DEPLOY_SERVICE_ACCOUNT=github-deploy@....iam.gserviceaccount.com \
#     bash scripts/gcp/ensure-wif-neon-secret-access.sh
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
SA_EMAIL="${WIF_DEPLOY_SERVICE_ACCOUNT:-github-deploy@${PROJECT_ID}.iam.gserviceaccount.com}"

gcloud secrets add-iam-policy-binding neon-database-url \
	--project="${PROJECT_ID}" \
	--member="serviceAccount:${SA_EMAIL}" \
	--role="roles/secretmanager.secretAccessor"

echo "OK: ${SA_EMAIL} has secretAccessor on neon-database-url (project ${PROJECT_ID})."
