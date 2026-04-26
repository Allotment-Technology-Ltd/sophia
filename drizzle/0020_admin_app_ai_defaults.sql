-- Application-wide AI defaults (Neon): shared Restormel route when per-stage pins are unset,
-- optional degraded-resolve provider/model overrides, and optional encrypted default OpenAI key.

CREATE TABLE IF NOT EXISTS admin_app_ai_defaults (
  id text PRIMARY KEY CHECK (id = 'default'),
  default_restormel_shared_route_id text,
  degraded_primary_provider text,
  degraded_reasoning_model_standard text,
  degraded_reasoning_model_deep text,
  degraded_extraction_model text,
  default_openai_api_key_encrypted jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_uid text
);

COMMENT ON TABLE admin_app_ai_defaults IS 'Sophia-wide Restormel shared route fallback, degraded model overrides, and optional encrypted OPENAI_API_KEY-style default (see appAiDefaults.ts).';
