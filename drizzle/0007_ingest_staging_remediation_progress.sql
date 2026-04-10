-- Mid-remediation checkpoint for ingest orchestration (resume after worker restart)
ALTER TABLE ingest_staging_meta ADD COLUMN IF NOT EXISTS remediation_progress JSONB;
