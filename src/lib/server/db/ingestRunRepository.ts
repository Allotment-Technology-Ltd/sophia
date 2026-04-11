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
    cancelledByUser: state.cancelledByUser === true,
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
  const row = await db.query.ingestRuns.findFirst({
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
    processStartedAt: undefined,
    processExitedAt: undefined,
    cancelledByUser: row.cancelledByUser,
    simulationInterval: null,
    syncSimulationTimeout: null,
    actorEmail: row.actorEmail ?? '',
    issues,
    lastReportPersistAt: undefined
  };

  return state;
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
export async function neonListIdleStalledIngestRunIds(idleMs: number, limit: number): Promise<string[]> {
  if (!isNeonIngestPersistenceEnabled() || idleMs <= 0) return [];
  const db = getDrizzleDb();
  const cap = Math.max(1, Math.min(100, limit));
  const rows = await db
    .select({ id: ingestRuns.id })
    .from(ingestRuns)
    .where(
      and(
        eq(ingestRuns.cancelledByUser, false),
        isNull(ingestRuns.completedAt),
        inArray(ingestRuns.status, ['running', 'queued', 'awaiting_sync']),
        sql`(
          (${ingestRuns.lastOutputAt} IS NOT NULL AND (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint - ${ingestRuns.lastOutputAt} > ${idleMs})
          OR (${ingestRuns.lastOutputAt} IS NULL AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${idleMs})
        )`
      )
    )
    .orderBy(asc(ingestRuns.updatedAt))
    .limit(cap);
  return rows.map((r) => r.id);
}

/**
 * Mark a run terminal (`error`) if it is still in-flight and past the idle threshold.
 * Idempotent: returns false if the row no longer matches (already terminal or activity resumed).
 * Appends one log line and one `watchdog` issue in the same transaction as the status update.
 */
export async function neonTerminalizeIngestRunWatchdogIdle(
  runId: string,
  idleMs: number
): Promise<boolean> {
  if (!isNeonIngestPersistenceEnabled() || idleMs <= 0) return false;
  const logLine = `[WATCHDOG] idle_timeout run_id=${runId} idle_ms=${idleMs}`;
  const errMsg = `watchdog_idle_timeout: no worker output for ${idleMs}ms (INGEST_WATCHDOG_IDLE_MS)`;
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
            (${ingestRuns.lastOutputAt} IS NOT NULL AND (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint - ${ingestRuns.lastOutputAt} > ${idleMs})
            OR (${ingestRuns.lastOutputAt} IS NULL AND (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM ${ingestRuns.createdAt})) * 1000 > ${idleMs})
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
