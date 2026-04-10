-- Launch throttle backoff + stuck-runner metadata for durable ingestion jobs.
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS launch_throttle_count INTEGER NOT NULL DEFAULT 0;
