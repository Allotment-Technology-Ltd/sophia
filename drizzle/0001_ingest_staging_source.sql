-- Optional follow-up if 0000 was already applied before source_json existed.
ALTER TABLE ingest_staging_meta ADD COLUMN IF NOT EXISTS source_json JSONB;
ALTER TABLE ingest_staging_meta ADD COLUMN IF NOT EXISTS validation_full JSONB;
ALTER TABLE ingest_staging_meta ADD COLUMN IF NOT EXISTS embeddings_json JSONB;
