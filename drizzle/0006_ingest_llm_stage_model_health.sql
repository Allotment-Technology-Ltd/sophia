-- Per-stage deprioritization for ingestion LLM fallback chains
CREATE TABLE IF NOT EXISTS ingest_llm_stage_model_health (
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  failure_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stage, provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_llm_stage_model_health_stage
  ON ingest_llm_stage_model_health (stage);

CREATE INDEX IF NOT EXISTS idx_ingest_llm_stage_model_health_updated
  ON ingest_llm_stage_model_health (updated_at DESC);
