-- Sophia Neon-first durable ingestion + document store
-- Apply with: psql "$DATABASE_URL" -f drizzle/0000_neon_first.sql
-- Requires Neon / Postgres with pgvector enabled (Neon: enable in console).

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Ingest orchestration ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingest_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  payload JSONB NOT NULL,
  payload_version INT NOT NULL DEFAULT 1,
  stages JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  actor_email TEXT,
  resumable BOOLEAN NOT NULL DEFAULT FALSE,
  last_failure_stage TEXT,
  source_file_path TEXT,
  fetch_retry_attempts INT NOT NULL DEFAULT 0,
  ingest_retry_attempts INT NOT NULL DEFAULT 0,
  sync_retry_attempts INT NOT NULL DEFAULT 0,
  current_stage_key TEXT,
  current_action TEXT,
  last_output_at BIGINT,
  cancelled_by_user BOOLEAN NOT NULL DEFAULT FALSE,
  sync_started_at TIMESTAMPTZ,
  sync_completed_at TIMESTAMPTZ,
  report_envelope JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_updated ON ingest_runs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_completed ON ingest_runs (completed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS ingest_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  seq INT NOT NULL,
  line TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ingest_run_logs_run_seq ON ingest_run_logs (run_id, seq);

CREATE TABLE IF NOT EXISTS ingest_run_issues (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  seq INT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  stage_hint TEXT,
  message TEXT NOT NULL,
  raw_line TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, seq)
);

-- ── Staging (worker checkpoints; replaces *-partial.json when orchestration run id set) ──

CREATE TABLE IF NOT EXISTS ingest_staging_meta (
  run_id TEXT PRIMARY KEY REFERENCES ingest_runs (id) ON DELETE CASCADE,
  slug TEXT NOT NULL DEFAULT '',
  source_json JSONB,
  stage_completed TEXT NOT NULL DEFAULT '',
  cost_usd_snapshot DOUBLE PRECISION,
  extraction_progress JSONB,
  grouping_progress JSONB,
  validation_progress JSONB,
  relations_progress JSONB,
  embedding_progress JSONB,
  validation_full JSONB,
  embeddings_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingest_staging_claims (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  position_in_source INT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_data JSONB NOT NULL,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, position_in_source)
);

CREATE INDEX IF NOT EXISTS idx_staging_claims_run ON ingest_staging_claims (run_id);

CREATE TABLE IF NOT EXISTS ingest_staging_relations (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  from_position INT NOT NULL,
  to_position INT NOT NULL,
  relation_type TEXT NOT NULL,
  relation_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, from_position, to_position, relation_type)
);

CREATE TABLE IF NOT EXISTS ingest_staging_arguments (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  argument_index INT NOT NULL,
  argument_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, argument_index)
);

CREATE TABLE IF NOT EXISTS ingest_staging_validation (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  position_in_source INT NOT NULL,
  faithfulness_score DOUBLE PRECISION,
  validation_data JSONB,
  UNIQUE (run_id, position_in_source)
);

-- ── Generic Firestore-shaped document mirror (SOPHIA_DATA_BACKEND=neon) ─────

CREATE TABLE IF NOT EXISTS sophia_documents (
  path TEXT PRIMARY KEY,
  top_collection TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  sort_created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sophia_docs_top_collection ON sophia_documents (top_collection);
CREATE INDEX IF NOT EXISTS idx_sophia_docs_sort_created ON sophia_documents (top_collection, sort_created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sophia_docs_key_hash ON sophia_documents ((data->>'key_hash'))
  WHERE top_collection = 'api_keys';
