import { asc, desc, eq, sql } from 'drizzle-orm';
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
