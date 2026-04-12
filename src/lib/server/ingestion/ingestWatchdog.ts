/**
 * Neon-backed idle watchdog for in-flight `ingest_runs` (admin runs and job children).
 * Complements per-job `INGEST_JOB_ITEM_STALE_MS` ticks when nothing is ticking jobs.
 */

import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import {
  neonListIdleStalledIngestCandidateRows,
  neonListWorkerOrphanCandidateRunIds,
  neonTerminalizeIngestRunWatchdogIdle,
  neonTerminalizeWorkerOrphanIfStale
} from '../db/ingestRunRepository';
import {
  ingestWatchdogListQueryIdleMs,
  isPastWatchdogThreshold,
  resolveWatchdogIdleThresholdMs
} from './ingestWatchdogPhaseBaselines';
import { ingestionJobItems } from '../db/schema';
import { ingestRunManager } from '../ingestRuns';
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
  const listIdleMs = ingestWatchdogListQueryIdleMs(idleMs);
  const candidates = await neonListIdleStalledIngestCandidateRows(listIdleMs, batch);
  out.examined = candidates.length;
  const requeue = ingestWatchdogRequeueJobItems();
  const errMsg = `watchdog_idle_timeout: no worker output for ${idleMs}ms (INGEST_WATCHDOG_IDLE_MS)`;

  const db = getDrizzleDb();
  const nowMs = Date.now();

  for (const row of candidates) {
    const runId = row.id;
    if (!isPastWatchdogThreshold(nowMs, row, idleMs)) continue;
    const thresholdMs = resolveWatchdogIdleThresholdMs(idleMs, row);
    const jobRows = await db
      .select({ jobId: ingestionJobItems.jobId })
      .from(ingestionJobItems)
      .where(
        and(eq(ingestionJobItems.childRunId, runId), eq(ingestionJobItems.status, 'running'))
      );
    const jobLinks = [...new Map(jobRows.map((r) => [r.jobId, r])).values()];

    const ok = await neonTerminalizeIngestRunWatchdogIdle(runId, thresholdMs);
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
      for (const link of jobLinks) {
        await appendIngestionJobEvent(link.jobId, 'watchdog_terminalized', {
          childRunId: runId,
          requeue,
          idleMs,
          thresholdMs
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
        idle_ms: idleMs,
        list_idle_ms: listIdleMs
      })}`
    );
  }

  return out;
}

/** Stale-output threshold for deploy/worker-loss recovery; unset or &lt;60s → disabled. */
export function getWorkerOrphanStaleMs(): number {
  const raw = process.env.INGEST_ORPHAN_LAST_OUTPUT_MS?.trim();
  if (raw === undefined || raw === '') return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 60_000) return 0;
  return Math.min(n, 3_600_000);
}

/** After orphan terminalization, call `resumeFromFailure` for durable job children (default on). */
export function ingestOrphanAutoResumeEnabled(): boolean {
  const v = (process.env.INGEST_ORPHAN_AUTO_RESUME ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export type WorkerOrphanSweepResult = {
  examined: number;
  terminalized: number;
  autoResumed: number;
  runIds: string[];
};

/**
 * Recover `ingest_runs` stuck `running` after a deploy/kill (no log/heartbeat for INGEST_ORPHAN_LAST_OUTPUT_MS).
 * For rows linked to a durable job item, optionally auto-call `resumeFromFailure` so work continues without an open admin tab.
 */
export async function sweepWorkerOrphanIngestRuns(): Promise<WorkerOrphanSweepResult> {
  const threshold = getWorkerOrphanStaleMs();
  const out: WorkerOrphanSweepResult = {
    examined: 0,
    terminalized: 0,
    autoResumed: 0,
    runIds: []
  };
  if (!isNeonIngestPersistenceEnabled() || threshold <= 0) return out;

  const ids = await neonListWorkerOrphanCandidateRunIds(threshold, 40);
  out.examined = ids.length;
  const db = getDrizzleDb();
  const autoResume = ingestOrphanAutoResumeEnabled();

  for (const runId of ids) {
    const ok = await neonTerminalizeWorkerOrphanIfStale(runId, threshold);
    if (!ok) continue;
    out.terminalized += 1;
    out.runIds.push(runId);

    const jobItems = await db
      .select({ jobId: ingestionJobItems.jobId })
      .from(ingestionJobItems)
      .where(and(eq(ingestionJobItems.childRunId, runId), eq(ingestionJobItems.status, 'running')));
    const linkedToJob = jobItems.length > 0;

    if (linkedToJob && autoResume) {
      try {
        const res = await ingestRunManager.resumeFromFailure(runId);
        if (res.ok) {
          out.autoResumed += 1;
        } else {
          console.warn(`[orphan] auto-resume skipped run=${runId}: ${res.error}`);
        }
      } catch (e) {
        console.warn('[orphan] auto-resume failed', runId, e instanceof Error ? e.message : String(e));
      }
    }

    if (linkedToJob) {
      const { appendIngestionJobEvent } = await import('../ingestionJobs.js');
      const jobLinks = [...new Map(jobItems.map((r) => [r.jobId, r])).values()];
      for (const link of jobLinks) {
        await appendIngestionJobEvent(link.jobId, 'worker_orphan_recovered', {
          childRunId: runId,
          thresholdMs: threshold,
          autoResume: linkedToJob && autoResume
        });
      }
    }
  }

  if (out.terminalized > 0) {
    console.log(
      `[INGEST_TELEMETRY] ${JSON.stringify({
        event: 'worker_orphan_sweep',
        ts_ms: Date.now(),
        examined: out.examined,
        terminalized: out.terminalized,
        auto_resumed: out.autoResumed,
        threshold_ms: threshold
      })}`
    );
  }

  return out;
}
