-- Operator UI: which Restormel route UUID applies to each ingestion phase.

CREATE TABLE IF NOT EXISTS admin_ingestion_restormel_route_bindings (
  id text PRIMARY KEY CHECK (id = 'default'),
  bindings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_uid text
);

COMMENT ON TABLE admin_ingestion_restormel_route_bindings IS 'Maps admin stage keys (ingestion_extraction, …) to Restormel route UUIDs; read by workers via Neon (overrides env route pins).';
