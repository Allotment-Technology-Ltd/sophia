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

/** Min 10s, max 120s; `0` = heartbeats off. */
export function ingestTelemetryHeartbeatMs(): number {
  const r = parseInt(process.env.INGEST_TELEMETRY_HEARTBEAT_MS ?? '0', 10);
  return Number.isFinite(r) && r >= 10_000 ? Math.min(r, 120_000) : 0;
}

async function bumpOrchestrationRunActivityBestEffort(): Promise<void> {
  const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
  if (!runId || !process.env.DATABASE_URL?.trim()) return;
  try {
    const { neonBumpRunActivity } = await import('../db/ingestRunRepository.js');
    await neonBumpRunActivity(runId, Date.now());
  } catch {
    /* non-fatal */
  }
}

/**
 * While `work()` runs, emit heartbeat telemetry on an interval and bump Neon `last_output_at`
 * when orchestration is enabled so idle watchdogs do not fire during long model calls.
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
    void bumpOrchestrationRunActivityBestEffort();
  }, intervalMs);
  try {
    return await opts.work();
  } finally {
    clearInterval(iv);
  }
}
