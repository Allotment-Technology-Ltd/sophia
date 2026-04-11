/**
 * Neon-backed idle watchdog for in-flight `ingest_runs` (admin runs and job children).
 * Complements per-job `INGEST_JOB_ITEM_STALE_MS` ticks when nothing is ticking jobs.
 */

import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import {
  neonListIdleStalledIngestRunIds,
  neonTerminalizeIngestRunWatchdogIdle
} from '../db/ingestRunRepository';
import { ingestionJobItems } from '../db/schema';
import { isNeonIngestPersistenceEnabled } from '../neon/datastore';

const DEFAULT_WATCHDOG_IDLE_MS = 300_000; // 5 minutes (release default)

/**
 * `INGEST_WATCHDOG_IDLE_MS`: idle threshold before Neon watchdog terminalizes in-flight runs.
 * Unset → 5 minutes. Set to `0` to disable. Values below 1 minute are treated as the default.
 */
export function getIngestWatchdogIdleMs(): number {
  const raw = process.env.INGEST_WATCHDOG_IDLE_MS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_WATCHDOG_IDLE_MS;
  const r = parseInt(raw, 10);
  if (!Number.isFinite(r)) return DEFAULT_WATCHDOG_IDLE_MS;
  if (r === 0) return 0;
  if (r < 60_000) return DEFAULT_WATCHDOG_IDLE_MS;
  return Math.min(r, 86_400_000);
}

export function ingestWatchdogRequeueJobItems(): boolean {
  const v = (process.env.INGEST_WATCHDOG_REQUEUE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export type IngestWatchdogSweepResult = {
  examined: number;
  terminalized: number;
  runIds: string[];
  requeuedItems: number;
};

const WATCHDOG_ITEM_ERR =
  'watchdog_idle_timeout on child run (INGEST_WATCHDOG_IDLE_MS); item cleared for retry or operator action.';

/**
 * Find stalled runs and terminalize each at most once. Optionally requeue linked job items.
 * Emits a single stdout JSON line per sweep for Cloud Logging when anything changed.
 */
export async function sweepStalledIngestRuns(): Promise<IngestWatchdogSweepResult> {
  const idleMs = getIngestWatchdogIdleMs();
  const out: IngestWatchdogSweepResult = {
    examined: 0,
    terminalized: 0,
    runIds: [],
    requeuedItems: 0
  };
  if (!isNeonIngestPersistenceEnabled() || idleMs <= 0) return out;

  const batchRaw = (process.env.INGEST_WATCHDOG_BATCH ?? '25').trim();
  const batch = Math.max(1, Math.min(100, parseInt(batchRaw, 10) || 25));
  const ids = await neonListIdleStalledIngestRunIds(idleMs, batch);
  out.examined = ids.length;
  const requeue = ingestWatchdogRequeueJobItems();
  const errMsg = `watchdog_idle_timeout: no worker output for ${idleMs}ms (INGEST_WATCHDOG_IDLE_MS)`;

  const db = getDrizzleDb();

  for (const runId of ids) {
    const jobRows = await db
      .select({ jobId: ingestionJobItems.jobId })
      .from(ingestionJobItems)
      .where(
        and(eq(ingestionJobItems.childRunId, runId), eq(ingestionJobItems.status, 'running'))
      );
    const jobLinks = [...new Map(jobRows.map((r) => [r.jobId, r])).values()];

    const ok = await neonTerminalizeIngestRunWatchdogIdle(runId, idleMs);
    if (!ok) continue;
    out.terminalized += 1;
    out.runIds.push(runId);

    if (requeue) {
      const res = await db
        .update(ingestionJobItems)
        .set({
          status: 'pending',
          childRunId: null,
          lastError: WATCHDOG_ITEM_ERR,
          updatedAt: new Date()
        })
        .where(
          and(eq(ingestionJobItems.childRunId, runId), eq(ingestionJobItems.status, 'running'))
        )
        .returning({ id: ingestionJobItems.id });
      out.requeuedItems += res.length;
    } else {
      await db
        .update(ingestionJobItems)
        .set({
          status: 'error',
          lastError: errMsg,
          updatedAt: new Date()
        })
        .where(
          and(eq(ingestionJobItems.childRunId, runId), eq(ingestionJobItems.status, 'running'))
        );
    }

    if (jobLinks.length > 0) {
      const { appendIngestionJobEvent } = await import('../ingestionJobs.js');
      for (const row of jobLinks) {
        await appendIngestionJobEvent(row.jobId, 'watchdog_terminalized', {
          childRunId: runId,
          requeue,
          idleMs
        });
      }
    }
  }

  if (out.terminalized > 0) {
    console.log(
      `[INGEST_TELEMETRY] ${JSON.stringify({
        event: 'watchdog_sweep',
        ts_ms: Date.now(),
        examined: out.examined,
        terminalized: out.terminalized,
        requeued_items: out.requeuedItems,
        idle_ms: idleMs
      })}`
    );
  }

  return out;
}
