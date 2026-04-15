#!/usr/bin/env bash
# Resume Cloud Scheduler jobs paused by pause-cost-saving-schedulers.sh.
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
    echo "Resuming ${job}…"
    gcloud scheduler jobs resume "${job}" --location="${LOCATION}" --project="${PROJECT_ID}"
  else
    echo "Skip ${job} (not found)."
  fi
done

echo "Done."
