-- Cluster-wide ingest worker slot counter (optional; see INGEST_GLOBAL_CONCURRENCY_GATE).
CREATE TABLE IF NOT EXISTS ingest_concurrency_gate (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  slots_in_use INT NOT NULL DEFAULT 0 CHECK (slots_in_use >= 0)
);
INSERT INTO ingest_concurrency_gate (id, slots_in_use) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
