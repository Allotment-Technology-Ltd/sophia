#!/usr/bin/env bash
# One-time (idempotent): Cloud Scheduler triggers the ingestion poller job every 2 minutes.
#
# Prerequisites:
#   - Job sophia-ingestion-job-poller already deployed (deploy.yml or deploy-sophia-ingestion-poller-job.sh)
#   - APIs: cloudscheduler.googleapis.com (see enable-required-apis.sh)
#
# Run with gcloud admin:
#   GCP_PROJECT_ID=sophia-488807 bash scripts/gcp/setup-ingestion-poller-scheduler.sh
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sophia-488807}"
REGION="${REGION:-europe-west2}"
JOB_NAME="${INGESTION_POLLER_JOB_NAME:-sophia-ingestion-job-poller}"
SCHEDULER_NAME="${INGESTION_POLLER_SCHEDULER_NAME:-sophia-ingestion-poller-tick}"
INVOKER_SA="${POLLER_SCHEDULER_INVOKER_SA:-sophia-poller-scheduler@${PROJECT_ID}.iam.gserviceaccount.com}"
INVOKER_SA_SHORT="sophia-poller-scheduler"

gcloud run jobs describe "${JOB_NAME}" --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null || {
	echo "ERROR: Cloud Run Job ${JOB_NAME} not found. Deploy the app (CI) or run scripts/gcp/deploy-sophia-ingestion-poller-job.sh first."
	exit 1
}

if ! gcloud iam service-accounts describe "${INVOKER_SA}" --project="${PROJECT_ID}" &>/dev/null; then
	echo "Creating service account ${INVOKER_SA}…"
	gcloud iam service-accounts create "${INVOKER_SA_SHORT}" \
		--project="${PROJECT_ID}" \
		--display-name="Sophia ingestion poller (scheduler invoker)"
fi

RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

echo "Binding run.invoker on job ${JOB_NAME} for ${INVOKER_SA}…"
gcloud run jobs add-iam-policy-binding "${JOB_NAME}" \
	--project="${PROJECT_ID}" \
	--region="${REGION}" \
	--member="serviceAccount:${INVOKER_SA}" \
	--role="roles/run.invoker"

if gcloud scheduler jobs describe "${SCHEDULER_NAME}" --location="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
	echo "Updating scheduler ${SCHEDULER_NAME}…"
	gcloud scheduler jobs update http "${SCHEDULER_NAME}" \
		--location="${REGION}" \
		--project="${PROJECT_ID}" \
		--schedule="*/2 * * * *" \
		--uri="${RUN_URI}" \
		--http-method=POST \
		--oauth-service-account-email="${INVOKER_SA}" \
		--attempt-deadline=320s
else
	echo "Creating scheduler ${SCHEDULER_NAME}…"
	gcloud scheduler jobs create http "${SCHEDULER_NAME}" \
		--location="${REGION}" \
		--project="${PROJECT_ID}" \
		--schedule="*/2 * * * *" \
		--uri="${RUN_URI}" \
		--http-method=POST \
		--oauth-service-account-email="${INVOKER_SA}" \
		--attempt-deadline=320s
fi

echo "OK: scheduler ${SCHEDULER_NAME} POSTs ${RUN_URI} every 2 minutes as ${INVOKER_SA}."
