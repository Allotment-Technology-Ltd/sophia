/**
 * Structured one-line JSON on stdout for GCP Cloud Logging + optional Neon activity bumps
 * when `INGEST_ORCHESTRATION_RUN_ID` + `DATABASE_URL` are set (orchestrated admin ingest).
 */

const PREFIX = '[INGEST_TELEMETRY]';

export function emitIngestTelemetry(fields: Record<string, unknown>): void {
  const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
  const payload = {
    ...fields,
    ts_ms: Date.now(),
    ...(runId ? { run_id: runId } : {})
  };
  console.log(`${PREFIX} ${JSON.stringify(payload)}`);
}

/** Parse a stdout line emitted by `emitIngestTelemetry` (tests + log processors). */
export function parseIngestTelemetryPayloadLine(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith(`${PREFIX} `)) return null;
  try {
    return JSON.parse(t.slice(PREFIX.length + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Min 10s, max 120s. Unset → **45s when `INGEST_ORCHESTRATION_RUN_ID` is set** (Neon orchestration),
 * else off. Set `INGEST_TELEMETRY_HEARTBEAT_MS=0` to disable even when orchestrated.
 */
export function ingestTelemetryHeartbeatMs(): number {
  const raw = process.env.INGEST_TELEMETRY_HEARTBEAT_MS?.trim();
  if (raw === '0') return 0;
  if (raw !== undefined && raw !== '') {
    const r = parseInt(raw, 10);
    return Number.isFinite(r) && r >= 10_000 ? Math.min(r, 120_000) : 0;
  }
  if (process.env.INGEST_ORCHESTRATION_RUN_ID?.trim()) return 45_000;
  return 0;
}

async function bumpOrchestrationWorkerHeartbeatBestEffort(): Promise<void> {
  const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
  if (!runId || !process.env.DATABASE_URL?.trim()) return;
  try {
    const { neonBumpWorkerHeartbeat } = await import('../db/ingestRunRepository.js');
    await neonBumpWorkerHeartbeat(runId, Date.now());
  } catch {
    /* non-fatal */
  }
}

/**
 * While `work()` runs, emit heartbeat telemetry on an interval and bump Neon `worker_heartbeat_at`
 * when orchestration is enabled so idle watchdogs see liveness without inflating log-driven idle.
 */
export async function runWithIngestTelemetryHeartbeat<T>(opts: {
  stage: string;
  work: () => Promise<T>;
}): Promise<T> {
  const intervalMs = ingestTelemetryHeartbeatMs();
  if (intervalMs <= 0) return opts.work();

  let beats = 0;
  const iv = setInterval(() => {
    beats += 1;
    emitIngestTelemetry({ event: 'heartbeat', stage: opts.stage, beat: beats });
    void bumpOrchestrationWorkerHeartbeatBestEffort();
  }, intervalMs);
  try {
    return await opts.work();
  } finally {
    clearInterval(iv);
  }
}
