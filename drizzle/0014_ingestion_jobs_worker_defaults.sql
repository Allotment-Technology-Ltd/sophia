-- Default worker tuning for durable multi-URL jobs (merged into each child `ingest_runs.payload.batch_overrides`).
ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS worker_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ingestion_jobs.worker_defaults IS 'Optional per-job ingest worker overrides (same shape as ingest batch_overrides subset); applied when spawning child runs.';
