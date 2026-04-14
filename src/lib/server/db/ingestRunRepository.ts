import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { IngestIssueRecord } from '$lib/server/ingestRunIssues';
import type { IngestRunPayload, IngestRunState, StageStatus } from '$lib/server/ingestRuns';
import { getDrizzleDb } from './neon';
import {
  ingestRunIssues,
  ingestRunLogs,
  ingestRuns,
  sophiaDocuments
} from './schema';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

/** Appended by `IngestRunManager` when the ingest child exits 0 (not emitted by `scripts/ingest.ts`). */
export const INGEST_ORCHESTRATOR_PIPELINE_DONE_LINE =
	'Ingestion pipeline finished successfully.' as const;

export async function neonCreateIngestRun(state: IngestRunState): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db.insert(ingestRuns).values({
    id: state.id,
    status: state.status,
    payload: state.payload as unknown as Record<string, unknown>,
    payloadVersion: state.payloadVersion ?? 1,
    stages: state.stages as unknown as Record<string, unknown>,
    error: state.error ?? null,
    sourceUrl: state.payload.source_url,
    sourceType: state.payload.source_type,
    actorEmail: state.actorEmail,
    resumable: state.resumable === true,
    lastFailureStage: state.lastFailureStageKey ?? null,
    sourceFilePath: state.sourceFilePath ?? null,
    fetchRetryAttempts: state.fetchRetryAttempts,
    ingestRetryAttempts: state.ingestRetryAttempts,
    syncRetryAttempts: state.syncRetryAttempts,
    currentStageKey: state.currentStageKey ?? null,
    currentAction: state.currentAction ?? null,
    lastOutputAt: state.lastOutputAt ?? null,
    workerHeartbeatAt: state.workerHeartbeatAt ?? null,
    cancelledByUser: state.cancelledByUser === true,
    excludeFromBatchSuggest: state.excludeFromBatchSuggest === true,
    syncStartedAt: state.syncStartedAt ? new Date(state.syncStartedAt) : null,
    syncCompletedAt: state.syncCompletedAt ? new Date(state.syncCompletedAt) : null,
    reportEnvelope: null,
    createdAt: new Date(state.createdAt),
    completedAt: state.completedAt ? new Date(state.completedAt) : null,
    updatedAt: new Date()
  });
}

export async function neonPersistIngestRunSnapshot(state: IngestRunState): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .update(ingestRuns)
    .set({
      status: state.status,
      payload: state.payload as unknown as Record<string, unknown>,
      payloadVersion: state.payloadVersion ?? 1,
      stages: state.stages as unknown as Record<string, unknown>,
      error: state.error ?? null,
      resumable: state.resumable === true,
      lastFailureStage: state.lastFailureStageKey ?? null,
      sourceFilePath: state.sourceFilePath ?? null,
      fetchRetryAttempts: state.fetchRetryAttempts,
      ingestRetryAttempts: state.ingestRetryAttempts,
      syncRetryAttempts: state.syncRetryAttempts,
      currentStageKey: state.currentStageKey ?? null,
      currentAction: state.currentAction ?? null,
      lastOutputAt: state.lastOutputAt ?? null,
      workerHeartbeatAt: state.workerHeartbeatAt ?? null,
      cancelledByUser: state.cancelledByUser === true,
      syncStartedAt: state.syncStartedAt ? new Date(state.syncStartedAt) : null,
      syncCompletedAt: state.syncCompletedAt ? new Date(state.syncCompletedAt) : null,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
      updatedAt: new Date()
    })
    .where(eq(ingestRuns.id, state.id));
}

export async function neonBumpRunActivity(runId: string, lastOutputAt: number): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .update(ingestRuns)
    .set({ lastOutputAt, updatedAt: new Date() })
    .where(eq(ingestRuns.id, runId));
}

/** Bumps worker liveness without advancing log-driven `last_output_at` (used during long model calls). */
export async function neonBumpWorkerHeartbeat(runId: string, workerHeartbeatAt: number): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .update(ingestRuns)
    .set({ workerHeartbeatAt, updatedAt: new Date() })
    .where(eq(ingestRuns.id, runId));
}

export async function neonAppendLogLine(runId: string, line: string): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  /** Serialize log appends per run: concurrent `void neonAppendLogLine` previously raced on MAX(seq)+1. */
  const ADV_LOCK_NS = 5_849_271;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_NS}, hashtext(${runId}))`);
    const [row] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${ingestRunLogs.seq}), 0)`.mapWith(Number) })
      .from(ingestRunLogs)
      .where(eq(ingestRunLogs.runId, runId));
    const nextSeq = (row?.m ?? 0) + 1;
    await tx.insert(ingestRunLogs).values({ runId, seq: nextSeq, line });
  });
}

export async function neonAppendIssue(runId: string, issue: IngestIssueRecord): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .insert(ingestRunIssues)
    .values({
      runId,
      seq: issue.seq,
      kind: issue.kind,
      severity: issue.severity,
      stageHint: issue.stageHint,
      message: issue.message,
      rawLine: issue.rawLine
    })
    .onConflictDoNothing({ target: [ingestRunIssues.runId, ingestRunIssues.seq] });
}

export async function neonSetReportEnvelope(runId: string, envelope: Record<string, unknown>): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .update(ingestRuns)
    .set({ reportEnvelope: envelope, updatedAt: new Date() })
    .where(eq(ingestRuns.id, runId));
}

/** Duplicate report into `sophia_documents` so Neon Firestore-compat queries (coach, analytics) work. */
export async function neonMirrorIngestReportDocument(
  runId: string,
  envelope: Record<string, unknown>
): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  const path = `ingestion_run_reports/${runId}`;
  const completedAtMs =
    typeof envelope.completedAtMs === 'number' ? envelope.completedAtMs : Date.now();
  const createdAtMs =
    typeof envelope.createdAtMs === 'number' ? envelope.createdAtMs : completedAtMs;
  const data = {
    ...envelope,
    runId: typeof envelope.runId === 'string' ? envelope.runId : runId,
    completedAt: {
      __fsTs: true,
      seconds: Math.floor(completedAtMs / 1000),
      nanoseconds: (completedAtMs % 1000) * 1_000_000
    },
    createdAt: {
      __fsTs: true,
      seconds: Math.floor(createdAtMs / 1000),
      nanoseconds: (createdAtMs % 1000) * 1_000_000
    }
  };
  await db
    .insert(sophiaDocuments)
    .values({
      path,
      topCollection: 'ingestion_run_reports',
      data,
      sortCreatedAt: new Date(completedAtMs),
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: sophiaDocuments.path,
      set: {
        data,
        sortCreatedAt: new Date(completedAtMs),
        updatedAt: new Date()
      }
    });
}

export async function neonMergePayloadAndVersion(
  runId: string,
  nextPayload: IngestRunPayload,
  nextVersion: number
): Promise<void> {
  if (!isNeonIngestPersistenceEnabled()) return;
  const db = getDrizzleDb();
  await db
    .update(ingestRuns)
    .set({
      payload: nextPayload as unknown as Record<string, unknown>,
      payloadVersion: nextVersion,
      updatedAt: new Date()
    })
    .where(eq(ingestRuns.id, runId));
}

export async function neonLoadIngestRun(runId: string): Promise<IngestRunState | null> {
  if (!isNeonIngestPersistenceEnabled()) return null;
  const db = getDrizzleDb();
  let row = await db.query.ingestRuns.findFirst({
    where: eq(ingestRuns.id, runId)
  });
  if (!row) return null;

  const logRows = await db
    .select()
    .from(ingestRunLogs)
    .where(eq(ingestRunLogs.runId, runId))
    .orderBy(desc(ingestRunLogs.seq))
    .limit(500);
  logRows.reverse();

  if (row.status === 'running') {
    const orchestratorFinished = logRows.some(
      (l) => l.line.trim() === INGEST_ORCHESTRATOR_PIPELINE_DONE_LINE
    );
    if (orchestratorFinished) {
      const now = new Date();
      const healed = await db
        .update(ingestRuns)
        .set({
          status: 'done',
          resumable: false,
          completedAt: row.completedAt ?? now,
          updatedAt: now
        })
        .where(and(eq(ingestRuns.id, runId), eq(ingestRuns.status, 'running')))
        .returning();
      if (healed.length > 0) {
        row = healed[0]!;
      }
    }
  }

  const issueRows = await db
    .select()
    .from(ingestRunIssues)
    .where(eq(ingestRunIssues.runId, runId))
    .orderBy(asc(ingestRunIssues.seq));

  const stages = row.stages as Record<string, StageStatus>;
  const payload = row.payload as unknown as IngestRunPayload;

  const issues: IngestIssueRecord[] = issueRows.map((r) => ({
    seq: r.seq,
    ts: r.createdAt.getTime(),
    kind: r.kind as IngestIssueRecord['kind'],
    severity: r.severity as IngestIssueRecord['severity'],
    stageHint: r.stageHint,
    message: r.message,
    rawLine: r.rawLine ?? ''
  }));

  const state: IngestRunState = {
    id: row.id,
    payloadVersion: row.payloadVersion,
    status: row.status as IngestRunState['status'],
    stages,
    logLines: logRows.map((l) => l.line),
    error: row.error ?? undefined,
    process: undefined,
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : undefined,
    payload,
    sourceFilePath: row.sourceFilePath ?? undefined,
    fetchRetryAttempts: row.fetchRetryAttempts,
    ingestRetryAttempts: row.ingestRetryAttempts,
    syncRetryAttempts: row.syncRetryAttempts,
    syncStartedAt: row.syncStartedAt ? row.syncStartedAt.getTime() : undefined,
    syncCompletedAt: row.syncCompletedAt ? row.syncCompletedAt.getTime() : undefined,
    currentStageKey: row.currentStageKey,
    currentAction: row.currentAction,
    lastFailureStageKey: row.lastFailureStage,
    resumable: row.resumable,
    lastOutputAt: row.lastOutputAt ?? undefined,
    workerHeartbeatAt: row.workerHeartbeatAt ?? undefined,
    processStartedAt: undefined,
    processExitedAt: undefined,
    cancelledByUser: row.cancelledByUser,
    excludeFromBatchSuggest: row.excludeFromBatchSuggest === true,
    simulationInterval: null,
    syncSimulationTimeout: null,
    actorEmail: row.actorEmail ?? '',
    issues,
    lastReportPersistAt: undefined
  };

  return state;
}

/** Persists operator preference for SEP batch URL helper exclusion. Returns rows updated (0 or 1). */
export async function neonUpdateExcludeFromBatchSuggest(
  runId: string,
  value: boolean
): Promise<number> {
  if (!isNeonIngestPersistenceEnabled()) return 0;
  const db = getDrizzleDb();
  const updated = await db
    .update(ingestRuns)
    .set({ excludeFromBatchSuggest: value, updatedAt: new Date() })
    .where(eq(ingestRuns.id, runId))
    .returning({ id: ingestRuns.id });
  return updated.length;
}

/**
 * Mark a child ingest run abandoned when its durable job is stopped (works for `queued` rows that
 * `cancelRun` cannot finalize in-process, and for workers not colocated with the admin API).
 */
export async function neonAbandonIngestRunForJobCancel(runId: string): Promise<number> {
  if (!isNeonIngestPersistenceEnabled()) return 0;
  const db = getDrizzleDb();
  const msg = 'Ingestion cancelled (durable job stopped by operator).';
  const updated = await db
    .update(ingestRuns)
    .set({
      cancelledByUser: true,
      status: 'error',
      error: msg,
      completedAt: new Date(),
      updatedAt: new Date(),
      currentAction: 'Job cancelled'
    })
    .where(
      and(eq(ingestRuns.id, runId), inArray(ingestRuns.status, ['queued', 'running', 'awaiting_sync']))
    )
    .returning({ id: ingestRuns.id });
  return updated.length;
}

/**
 * Claims the oldest queued ingest run with a compare-and-swap update.
 * Safe for multiple pollers; losers simply receive null and retry later.
 */
export async function neonClaimNextQueuedRun(): Promise<IngestRunState | null> {
  if (!isNeonIngestPersistenceEnabled()) return null;
  const db = getDrizzleDb();

  const candidate = await db
    .select({ id: ingestRuns.id })
    .from(ingestRuns)
    .where(eq(ingestRuns.status, 'queued'))
    .orderBy(asc(ingestRuns.createdAt))
    .limit(1);

  const runId = candidate[0]?.id;
  if (!runId) return null;

  const claimed = await db
    .update(ingestRuns)
    .set({
      status: 'running',
      currentAction: 'Dequeued by worker',
      currentStageKey: 'fetch',
      updatedAt: new Date()
    })
    .where(and(eq(ingestRuns.id, runId), eq(ingestRuns.status, 'queued')))
    .returning({ id: ingestRuns.id });

  if (claimed.length === 0) return null;
  return await neonLoadIngestRun(runId);
}

export async function neonListRecentReportRows(limit: number): Promise<
  Array<{
    runId: string;
    status: string;
    sourceUrl: string;
    sourceType: string;
    createdAtMs: number;
    completedAtMs: number;
    terminalError: string | null;
    lastFailureStageKey: string | null;
  }>
> {
  if (!isNeonIngestPersistenceEnabled()) return [];
  const db = getDrizzleDb();
  const cap = Math.max(1, Math.min(100, limit));
  const rows = await db
    .select()
    .from(ingestRuns)
    .orderBy(desc(sql`COALESCE(${ingestRuns.completedAt}, ${ingestRuns.updatedAt})`))
    .limit(cap);

  return rows.map((r) => ({
    runId: r.id,
    status: r.status,
    sourceUrl: r.sourceUrl,
    sourceType: r.sourceType,
    createdAtMs: r.createdAt.getTime(),
    completedAtMs: (r.completedAt ?? r.updatedAt).getTime(),
    terminalError: r.error ?? null,
    lastFailureStageKey: r.lastFailureStage
  }));
}

export async function neonGetReportEnvelope(runId: string): Promise<Record<string, unknown> | null> {
  if (!isNeonIngestPersistenceEnabled()) return null;
  const db = getDrizzleDb();
  const row = await db.query.ingestRuns.findFirst({
    where: eq(ingestRuns.id, runId),
    columns: { reportEnvelope: true }
  });
  const env = row?.reportEnvelope;
  return env && typeof env === 'object' && !Array.isArray(env) ? (env as Record<string, unknown>) : null;
}

const ADV_LOCK_WATCHDOG = 5_849_270;
const ADV_LOCK_INGEST_LOGS = 5_849_271;

/**
 * In-flight ingest rows with no recent output (Neon clock). Used by the idle watchdog.
 * `idleMs` must be > 0; callers typically cap batch size.
 */
const idleStallWhereSql = (idleMs: number) =>
  sql`(
          (
            (${ingestRuns.lastOutputAt} IS NOT NULL OR ${ingestRuns.workerHeartbeatAt} IS NOT NULL)
            AND (
              (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
              - GREATEST(
                  COALESCE(${ingestRuns.lastOutputAt}, 0::bigint),
                  COALESCE(${ingestRuns.workerHeartbeatAt}, 0::bigint)
                )
            ) > ${idleMs}
          )
          OR (
            ${ingestRuns.lastOutputAt} IS NULL
            AND ${ingestRuns.workerHeartbeatAt} IS NULL
            AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${idleMs}
          )
        )`;

/**
 * Same predicate as `idleStallWhereSql` but with alias `ir` for `FROM ingest_runs ir`.
 * Drizzle's `${ingestRuns.lastOutputAt}` renders as `"ingest_runs"."last_output_at"`, which is
 * invalid when the query only exposes alias `ir` (PostgreSQL hides the table name).
 */
const idleStallWhereSqlIr = (idleMs: number) =>
  sql`(
          (
            (ir.last_output_at IS NOT NULL OR ir.worker_heartbeat_at IS NOT NULL)
            AND (
              (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
              - GREATEST(
                  COALESCE(ir.last_output_at, 0::bigint),
                  COALESCE(ir.worker_heartbeat_at, 0::bigint)
                )
            ) > ${idleMs}
          )
          OR (
            ir.last_output_at IS NULL
            AND ir.worker_heartbeat_at IS NULL
            AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ir.created_at)) * 1000 > ${idleMs}
          )
        )`;

export type IdleStalledIngestCandidateRow = {
  id: string;
  currentStageKey: string | null;
  createdAtMs: number;
  lastOutputAt: number | null;
  workerHeartbeatAt: number | null;
  lastIngestTimingLine: string | null;
};

/**
 * Candidate stalled runs (same idle predicate as the watchdog) with context for phase-aware grace.
 */
export async function neonListIdleStalledIngestCandidateRows(
  idleMs: number,
  limit: number
): Promise<IdleStalledIngestCandidateRow[]> {
  if (!isNeonIngestPersistenceEnabled() || idleMs <= 0) return [];
  const db = getDrizzleDb();
  const cap = Math.max(1, Math.min(100, limit));
  const rows = await db.execute(sql`
    SELECT
      ir.id AS id,
      ir.current_stage_key AS "currentStageKey",
      (EXTRACT(EPOCH FROM ir.created_at) * 1000)::bigint AS "createdAtMs",
      ir.last_output_at AS "lastOutputAt",
      ir.worker_heartbeat_at AS "workerHeartbeatAt",
      (
        SELECT l.line
        FROM ${ingestRunLogs} l
        WHERE l.run_id = ir.id AND l.line LIKE '[INGEST_TIMING] %'
        ORDER BY l.seq DESC
        LIMIT 1
      ) AS "lastIngestTimingLine"
    FROM ${ingestRuns} ir
    WHERE ir.cancelled_by_user = false
      AND ir.completed_at IS NULL
      AND ir.status IN ('running', 'queued', 'awaiting_sync')
      AND ${idleStallWhereSqlIr(idleMs)}
    ORDER BY ir.updated_at ASC
    LIMIT ${cap}
  `);
  const out: IdleStalledIngestCandidateRow[] = [];
  for (const r of rows.rows as Record<string, unknown>[]) {
    out.push({
      id: String(r.id),
      currentStageKey: r.currentStageKey != null ? String(r.currentStageKey) : null,
      createdAtMs: Number(r.createdAtMs),
      lastOutputAt: r.lastOutputAt != null ? Number(r.lastOutputAt) : null,
      workerHeartbeatAt: r.workerHeartbeatAt != null ? Number(r.workerHeartbeatAt) : null,
      lastIngestTimingLine: r.lastIngestTimingLine != null ? String(r.lastIngestTimingLine) : null
    });
  }
  return out;
}

export async function neonListIdleStalledIngestRunIds(idleMs: number, limit: number): Promise<string[]> {
  const rows = await neonListIdleStalledIngestCandidateRows(idleMs, limit);
  return rows.map((r) => r.id);
}

/**
 * Mark a run terminal (`error`) if it is still in-flight and past the idle threshold.
 * Idempotent: returns false if the row no longer matches (already terminal or activity resumed).
 * Appends one log line and one `watchdog` issue in the same transaction as the status update.
 */
export async function neonTerminalizeIngestRunWatchdogIdle(
  runId: string,
  thresholdMs: number
): Promise<boolean> {
  if (!isNeonIngestPersistenceEnabled() || thresholdMs <= 0) return false;
  const logLine = `[WATCHDOG] idle_timeout run_id=${runId} threshold_ms=${thresholdMs} (INGEST_WATCHDOG_IDLE_MS + phase rules)`;
  const errMsg = `watchdog_idle_timeout: no worker output for ${thresholdMs}ms (watchdog threshold; see INGEST_WATCHDOG_IDLE_MS and phase baselines)`;
  const db = getDrizzleDb();

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_WATCHDOG}, hashtext(${runId}))`);
    const updated = await tx
      .update(ingestRuns)
      .set({
        status: 'error',
        error: errMsg,
        completedAt: new Date(),
        updatedAt: new Date(),
        lastFailureStage: 'watchdog',
        currentAction: 'Watchdog: idle timeout'
      })
      .where(
        and(
          eq(ingestRuns.id, runId),
          eq(ingestRuns.cancelledByUser, false),
          isNull(ingestRuns.completedAt),
          inArray(ingestRuns.status, ['running', 'queued', 'awaiting_sync']),
          sql`(
            (
              (${ingestRuns.lastOutputAt} IS NOT NULL OR ${ingestRuns.workerHeartbeatAt} IS NOT NULL)
              AND (
                (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
                - GREATEST(
                    COALESCE(${ingestRuns.lastOutputAt}, 0::bigint),
                    COALESCE(${ingestRuns.workerHeartbeatAt}, 0::bigint)
                  )
              ) > ${thresholdMs}
            )
            OR (
              ${ingestRuns.lastOutputAt} IS NULL
              AND ${ingestRuns.workerHeartbeatAt} IS NULL
              AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${thresholdMs}
            )
          )`
        )
      )
      .returning({ id: ingestRuns.id });

    if (updated.length === 0) return false;

    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_INGEST_LOGS}, hashtext(${runId}))`);
    const [logRow] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${ingestRunLogs.seq}), 0)`.mapWith(Number) })
      .from(ingestRunLogs)
      .where(eq(ingestRunLogs.runId, runId));
    const logSeq = (logRow?.m ?? 0) + 1;
    await tx.insert(ingestRunLogs).values({ runId, seq: logSeq, line: logLine });

    const [issueRow] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${ingestRunIssues.seq}), 0)`.mapWith(Number) })
      .from(ingestRunIssues)
      .where(eq(ingestRunIssues.runId, runId));
    const issueSeq = (issueRow?.m ?? 0) + 1;
    await tx.insert(ingestRunIssues).values({
      runId,
      seq: issueSeq,
      kind: 'watchdog',
      severity: 'high',
      stageHint: 'watchdog',
      message: errMsg,
      rawLine: logLine
    });

    return true;
  });
}

const ADV_LOCK_WORKER_ORPHAN = 5_849_268;

/**
 * When `INGEST_ORPHAN_LAST_OUTPUT_MS` > 0, the poller uses this to recover `ingest_runs` left `running`
 * after a deploy/worker kill (no log/heartbeat vs threshold). Only `status=running` (not queued / awaiting_sync).
 */
export async function neonTerminalizeWorkerOrphanIfStale(
  runId: string,
  thresholdMs: number
): Promise<boolean> {
  if (!isNeonIngestPersistenceEnabled() || thresholdMs <= 0) return false;
  const logLine = `[ORPHAN] worker_stale run_id=${runId} threshold_ms=${thresholdMs} (INGEST_ORPHAN_LAST_OUTPUT_MS)`;
  const errMsg = `worker_orphan_timeout: no worker log/heartbeat for ${thresholdMs}ms (INGEST_ORPHAN_LAST_OUTPUT_MS); worker process likely restarted. With INGEST_ORPHAN_AUTO_RESUME=1, the poller resumes durable job children from checkpoint.`;
  const db = getDrizzleDb();

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_WORKER_ORPHAN}, hashtext(${runId}))`);
    const updated = await tx
      .update(ingestRuns)
      .set({
        status: 'error',
        error: errMsg,
        completedAt: new Date(),
        updatedAt: new Date(),
        lastFailureStage: 'watchdog',
        currentAction: 'Worker orphan: stale output'
      })
      .where(
        and(
          eq(ingestRuns.id, runId),
          eq(ingestRuns.status, 'running'),
          eq(ingestRuns.cancelledByUser, false),
          isNull(ingestRuns.completedAt),
          sql`(
            (
              (${ingestRuns.lastOutputAt} IS NOT NULL OR ${ingestRuns.workerHeartbeatAt} IS NOT NULL)
              AND (
                (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
                - GREATEST(
                    COALESCE(${ingestRuns.lastOutputAt}, 0::bigint),
                    COALESCE(${ingestRuns.workerHeartbeatAt}, 0::bigint)
                  )
              ) > ${thresholdMs}
            )
            OR (
              ${ingestRuns.lastOutputAt} IS NULL
              AND ${ingestRuns.workerHeartbeatAt} IS NULL
              AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${thresholdMs}
            )
          )`
        )
      )
      .returning({ id: ingestRuns.id });

    if (updated.length === 0) return false;

    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_INGEST_LOGS}, hashtext(${runId}))`);
    const [logRow] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${ingestRunLogs.seq}), 0)`.mapWith(Number) })
      .from(ingestRunLogs)
      .where(eq(ingestRunLogs.runId, runId));
    const logSeq = (logRow?.m ?? 0) + 1;
    await tx.insert(ingestRunLogs).values({ runId, seq: logSeq, line: logLine });

    const [issueRow] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${ingestRunIssues.seq}), 0)`.mapWith(Number) })
      .from(ingestRunIssues)
      .where(eq(ingestRunIssues.runId, runId));
    const issueSeq = (issueRow?.m ?? 0) + 1;
    await tx.insert(ingestRunIssues).values({
      runId,
      seq: issueSeq,
      kind: 'watchdog',
      severity: 'high',
      stageHint: 'watchdog',
      message: errMsg,
      rawLine: logLine
    });

    return true;
  });
}

export async function neonListWorkerOrphanCandidateRunIds(
  thresholdMs: number,
  limit: number
): Promise<string[]> {
  if (!isNeonIngestPersistenceEnabled() || thresholdMs <= 0) return [];
  const cap = Math.max(1, Math.min(80, limit));
  const db = getDrizzleDb();
  const rows = await db
    .select({ id: ingestRuns.id })
    .from(ingestRuns)
    .where(
      and(
        eq(ingestRuns.status, 'running'),
        eq(ingestRuns.cancelledByUser, false),
        isNull(ingestRuns.completedAt),
        sql`(
            (
              (${ingestRuns.lastOutputAt} IS NOT NULL OR ${ingestRuns.workerHeartbeatAt} IS NOT NULL)
              AND (
                (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
                - GREATEST(
                    COALESCE(${ingestRuns.lastOutputAt}, 0::bigint),
                    COALESCE(${ingestRuns.workerHeartbeatAt}, 0::bigint)
                  )
              ) > ${thresholdMs}
            )
            OR (
              ${ingestRuns.lastOutputAt} IS NULL
              AND ${ingestRuns.workerHeartbeatAt} IS NULL
              AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${thresholdMs}
            )
          )`
      )
    )
    .limit(cap);
  return rows.map((r) => r.id);
}
