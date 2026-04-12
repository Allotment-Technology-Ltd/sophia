-- Audit trail for corrected ingest USD snapshots (e.g. after adding Vertex Gemini 3 token rates).
-- `cost_usd_snapshot_prior` freezes the pre-backfill value once; `cost_usd_snapshot_backfilled_at` marks operator recompute runs.

ALTER TABLE ingest_staging_meta
  ADD COLUMN IF NOT EXISTS cost_usd_snapshot_prior double precision;

ALTER TABLE ingest_staging_meta
  ADD COLUMN IF NOT EXISTS cost_usd_snapshot_backfilled_at timestamptz;

COMMENT ON COLUMN ingest_staging_meta.cost_usd_snapshot_prior IS 'Pre-backfill cost_usd_snapshot (set once when backfill script updates pricing).';
COMMENT ON COLUMN ingest_staging_meta.cost_usd_snapshot_backfilled_at IS 'Timestamp of last cost_usd_snapshot backfill from timingTelemetry.';
