-- Operator flag: treat this run's source URL like "already picked" for SEP catalog batch URL helper
-- when "Exclude already ingested" is enabled (see `sepEntryBatchPick.ts`).

ALTER TABLE ingest_runs
  ADD COLUMN IF NOT EXISTS exclude_from_batch_suggest boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ingest_runs.exclude_from_batch_suggest IS 'When true, canonical source_url is merged into the SEP batch exclude set alongside completed ingests.';

CREATE INDEX IF NOT EXISTS idx_ingest_runs_exclude_batch_suggest
  ON ingest_runs (exclude_from_batch_suggest)
  WHERE exclude_from_batch_suggest = true;
