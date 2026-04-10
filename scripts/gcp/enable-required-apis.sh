#!/usr/bin/env bash
# Enable APIs needed for Sophia deploy, Neon migrations, and ingestion poller job + scheduler.
# Safe to re-run.
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"

gcloud services enable \
	run.googleapis.com \
	artifactregistry.googleapis.com \
	cloudbuild.googleapis.com \
	secretmanager.googleapis.com \
	cloudscheduler.googleapis.com \
	iamcredentials.googleapis.com \
	--project="${PROJECT_ID}"

echo "OK: required APIs enabled for ${PROJECT_ID}."
