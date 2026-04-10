-- Durable multi-URL ingestion jobs (Wave 1: Neon + admin API + poll UI).
-- Run: drizzle migrate / apply via your Neon migration process.

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  concurrency INTEGER NOT NULL DEFAULT 2,
  actor_uid TEXT,
  actor_email TEXT,
  notes TEXT,
  validate_llm BOOLEAN NOT NULL DEFAULT FALSE,
  summary JSONB NOT NULL DEFAULT '{}',
  pipeline_version TEXT,
  embedding_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_updated ON ingestion_jobs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs (status);

CREATE TABLE IF NOT EXISTS ingestion_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ingestion_jobs (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'institutional',
  status TEXT NOT NULL DEFAULT 'pending',
  child_run_id TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  queue_record_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_job_items_job ON ingestion_job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_job_items_job_status ON ingestion_job_items (job_id, status);

CREATE TABLE IF NOT EXISTS ingestion_job_events (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ingestion_jobs (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_job_events_job_seq_unique UNIQUE (job_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_job_events_job_seq ON ingestion_job_events (job_id, seq);
