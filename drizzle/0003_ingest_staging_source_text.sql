-- Full source text for resuming ingestion when Cloud Run / workers have no data/sources/*.txt
ALTER TABLE ingest_staging_meta ADD COLUMN IF NOT EXISTS source_text_snapshot TEXT;
