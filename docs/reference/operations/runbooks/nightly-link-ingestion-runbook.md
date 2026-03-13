---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting operational reference only.

# Nightly Link Ingestion Runbook

**Status:** Implemented (Phase 3)
**Last updated:** 2026-03-10
**Schedule target:** Daily at 02:00 UTC

## Purpose
Operate the deferred ingestion pipeline that processes opted-in user and grounding links overnight and promotes approved sources into the shared knowledge graph.

## Preconditions
- Queue table exists and receives records from `/api/analyse` only when `queue_for_nightly_ingest=true`.
- Allowlist policy is configured:
  - Trusted domains auto-approved.
  - Non-trusted domains routed to manual review.
- Nightly Cloud Run Job and Cloud Scheduler are provisioned:
  - Job: `sophia-nightly-link-ingest`
  - Scheduler: `sophia-nightly-link-ingest-0200`

## Scheduler & Job Commands
```bash
# Trigger nightly ingestion immediately
gcloud run jobs execute sophia-nightly-link-ingest --region europe-west2

# List recent nightly executions
gcloud run jobs executions list --job=sophia-nightly-link-ingest --region europe-west2 --limit=20

# Describe scheduler state
gcloud scheduler jobs describe sophia-nightly-link-ingest-0200 --location=europe-west2

# Pause / resume scheduler
gcloud scheduler jobs pause sophia-nightly-link-ingest-0200 --location=europe-west2
gcloud scheduler jobs resume sophia-nightly-link-ingest-0200 --location=europe-west2
```

## Daily Operator Checks
1. Confirm scheduler last run status and next scheduled run.
2. Check queue backlog by status (`queued`, `pending_review`, `approved`, `failed`).
3. Check previous run error rate and retry counts.
4. Confirm no SLA breach on pending manual reviews.

## Queue Inspection (SurrealDB examples)
```sql
SELECT status, count() AS n FROM link_ingestion_queue GROUP BY status;
SELECT * FROM link_ingestion_queue WHERE status = 'pending_review' ORDER BY created_at DESC LIMIT 50;
SELECT * FROM link_ingestion_queue WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 50;
```

## Allowlist Review Flow
1. Review `pending_review` links.
2. Approve trusted/high-quality sources:
```sql
UPDATE link_ingestion_queue SET status = 'approved', approved_at = time::now() WHERE id = $id;
```
3. Reject low-quality/untrusted sources:
```sql
UPDATE link_ingestion_queue SET status = 'rejected', last_error = 'domain_not_allowed' WHERE id = $id;
```
4. Track decision rationale for auditability.

## Manual Rerun
- Execute nightly job on demand after major queue buildup or policy updates.
- Re-run only approved items; do not bypass review gate.
- Runtime command:
```bash
gcloud run jobs execute sophia-nightly-link-ingest --region europe-west2
```

## Failure Recovery
1. If job fails globally, inspect Cloud Run Job logs.
2. If only subset fails, items should be marked `failed` with `last_error` and `attempt_count` incremented.
3. Requeue eligible failures (after root cause fix):
```sql
UPDATE link_ingestion_queue
SET status = 'approved', last_error = NONE
WHERE status = 'failed' AND attempt_count < 3;
```
4. Keep hard-failed items in `failed` for manual triage.

## Retry Policy
- Per-item max retries: 3.
- Exponential backoff between attempts.
- After max retries: status remains `failed` until manual action.

## Health Checks
- Runtime health: `/api/health`
- Queue health:
  - backlog size under threshold
  - failed-rate under threshold
  - oldest `approved` item age under threshold
- Citation policy health:
  - spot-check Synthesis/Verification outputs for Harvard references section

## Pause and Resume
- Pause scheduler during incidents or cost events.
- Resume after validation of queue integrity and worker stability.

## Incident Triggers
- Queue backlog spikes rapidly.
- Failed item ratio exceeds threshold for two runs.
- Repeated ingestion failures on trusted domains.
- Nightly run duration exceeds Cloud Run job timeout budget.

## Escalation
1. Disable ingestion feature flag(s).
2. Pause scheduler.
3. Preserve queue state for replay.
4. Open incident summary with root cause and remediation plan.

## Worker Configuration (Cloud Run env)
- `NIGHTLY_INGEST_BATCH_SIZE` (default `20`)
- `NIGHTLY_INGEST_MAX_RETRIES` (default `3`)
- `NIGHTLY_INGEST_RETRY_BASE_MS` (default `1000`)
- `NIGHTLY_INGEST_VALIDATE` (default `false`)
