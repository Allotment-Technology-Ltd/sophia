-- Optional per-phase concurrency (see INGEST_PHASE_EMBED_MAX_CONCURRENT).
CREATE TABLE IF NOT EXISTS ingest_phase_gate (
  phase TEXT PRIMARY KEY,
  slots_in_use INT NOT NULL DEFAULT 0 CHECK (slots_in_use >= 0)
);
INSERT INTO ingest_phase_gate(phase) VALUES ('embed') ON CONFLICT (phase) DO NOTHING;
INSERT INTO ingest_phase_gate(phase) VALUES ('store') ON CONFLICT (phase) DO NOTHING;
