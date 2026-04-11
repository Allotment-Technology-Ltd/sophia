-- Dead-letter metadata for durable ingestion job items (exhausted retries + replay).
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS dlq_enqueued_at TIMESTAMPTZ;
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS last_failure_kind TEXT;
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS failure_class TEXT;
ALTER TABLE ingestion_job_items ADD COLUMN IF NOT EXISTS dlq_replay_count INTEGER NOT NULL DEFAULT 0;
