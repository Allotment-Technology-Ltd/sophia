-- Per-canonical-source flag: exclude corpus from model training / distillation exports.
-- Populated on successful ingest completion (Neon) and mirrored on Surreal `source` rows.
-- See `scripts/backfill-source-training-exclusion.ts` for legacy backfill.

CREATE TABLE IF NOT EXISTS source_training_governance (
  canonical_url_hash text PRIMARY KEY,
  source_url text NOT NULL,
  exclude_from_model_training boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_training_governance_source_url
  ON source_training_governance (source_url);

COMMENT ON TABLE source_training_governance IS 'Training/export governance keyed by canonical_url_hash; upserted when ingest completes.';
COMMENT ON COLUMN source_training_governance.exclude_from_model_training IS 'When true, omit this source from training manifests and fine-tune exports.';
