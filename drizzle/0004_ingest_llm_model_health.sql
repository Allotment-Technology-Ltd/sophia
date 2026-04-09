-- Cross-run deprioritization for ingestion LLM fallback chains (failure / success tallies)
CREATE TABLE IF NOT EXISTS ingest_llm_model_health (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  failure_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_llm_model_health_updated
  ON ingest_llm_model_health (updated_at DESC);
