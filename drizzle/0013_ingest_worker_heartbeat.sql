-- Worker liveness vs orchestration log activity (Neon idle watchdog).
-- `last_output_at` continues to reflect log lines / operator-visible progress.
-- `worker_heartbeat_at` is bumped by INGEST_TELEMETRY_HEARTBEAT_MS during long model calls.

ALTER TABLE ingest_runs
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at bigint;

COMMENT ON COLUMN ingest_runs.worker_heartbeat_at IS 'Unix epoch ms: last worker heartbeat (telemetry); idle watchdog uses GREATEST(last_output_at, worker_heartbeat_at).';
