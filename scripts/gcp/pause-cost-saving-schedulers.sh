#!/usr/bin/env bash
# Pause Cloud Scheduler jobs that drive recurring GCP spend (poller ticks, nightly ingest).
# Run with: pnpm gcp:pause-cost-schedulers  (or bash scripts/gcp/pause-cost-saving-schedulers.sh)
#
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-${PROJECT_ID:-sophia-488807}}"
LOCATION="${SCHEDULER_LOCATION:-europe-west2}"

JOBS=(
  "sophia-ingestion-job-poller-tick"
  "sophia-nightly-link-ingest-0200"
)

for job in "${JOBS[@]}"; do
  if gcloud scheduler jobs describe "${job}" --location="${LOCATION}" --project="${PROJECT_ID}" &>/dev/null; then
    echo "Pausing ${job}…"
    gcloud scheduler jobs pause "${job}" --location="${LOCATION}" --project="${PROJECT_ID}"
  else
    echo "Skip ${job} (not found — may never have been created)."
  fi
done

echo "Done. Resume with: pnpm gcp:resume-cost-schedulers"
