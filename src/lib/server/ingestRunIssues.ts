/**
 * Classifies ingestion worker log lines into structured issues for review and Firestore retention.
 * Pairs with `ingestRuns.ts` (in-memory) and `ingestion_run_reports` in Firestore (durable).
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';

export type IngestIssueKind =
  | 'warning'
  | 'retry'
  | 'json_repair'
  | 'batch_split'
  | 'budget'
  | 'resume_checkpoint'
  | 'parse_or_schema'
  | 'truncation'
  | 'grouping_integrity'
  | 'fetch_retry'
  | 'sync_retry'
  | 'ingest_retry'
  | 'cancelled'
  | 'routing_degraded'
  | 'other_signal';

export type IngestIssueSeverity = 'info' | 'low' | 'medium' | 'high';

export interface IngestIssueRecord {
  /** Stable within a run (ordinal) */
  seq: number;
  ts: number;
  kind: IngestIssueKind;
  severity: IngestIssueSeverity;
  /** Pipeline stage key when inferrable: extract, relate, … */
  stageHint: string | null;
  message: string;
  /** Truncated raw log line for forensics */
  rawLine: string;
}

const MAX_RAW_LINE = 2000;
const MAX_ISSUES_PER_RUN = 600;

const FIRESTORE_COLLECTION = 'ingestion_run_reports';

function truncateLine(line: string): string {
  const t = line.trim();
  if (t.length <= MAX_RAW_LINE) return t;
  return `${t.slice(0, MAX_RAW_LINE)}…`;
}

function inferStageFromLine(line: string): string | null {
  const m =
    line.match(/\[ROUTE\]\s+([a-z_]+)/i) ||
    line.match(/\[RETRY\]\s+([a-z_]+)/i) ||
    line.match(/\[WARN\]\s+([a-z_]+)/i);
  if (m?.[1]) {
    const s = m[1].toLowerCase();
    if (s.startsWith('extract')) return 'extract';
    if (s.startsWith('relat')) return 'relate';
    if (s.startsWith('group')) return 'group';
    if (s.startsWith('validat')) return 'validate';
    if (s.startsWith('embed')) return 'embed';
    if (s.includes('json') || s.includes('repair')) return 'extract';
    return s;
  }
  return null;
}

/**
 * Returns a structured issue when the line is worth recording; otherwise null.
 */
export function classifyIngestLogLine(line: string, seq: number): IngestIssueRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const stageHint = inferStageFromLine(trimmed);
  const rawLine = truncateLine(trimmed);

  if (/\[CANCEL\]/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'cancelled',
      severity: 'medium',
      stageHint,
      message: 'Run cancelled by operator.',
      rawLine
    };
  }

  if (/Fetch failed;\s*retrying once automatically/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'fetch_retry',
      severity: 'medium',
      stageHint: 'fetch',
      message: 'Fetch failed; automatic retry.',
      rawLine
    };
  }

  if (/SurrealDB sync failed;\s*retrying once automatically/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'sync_retry',
      severity: 'high',
      stageHint: 'store',
      message: 'SurrealDB sync failed; automatic retry.',
      rawLine
    };
  }

  if (/Ingest failed;\s*retrying once automatically/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'ingest_retry',
      severity: 'high',
      stageHint,
      message: 'Ingest failed; automatic retry from checkpoint.',
      rawLine
    };
  }

  if (/\[FIX\]|Repair route:/i.test(trimmed) || /Attempting fix/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'json_repair',
      severity: 'medium',
      stageHint: stageHint ?? 'extract',
      message: 'JSON repair or fix path engaged (malformed model output).',
      rawLine
    };
  }

  if (/JSON parse\/validation failed|parse\/validation failed/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'parse_or_schema',
      severity: 'medium',
      stageHint,
      message: 'JSON parse or schema validation failed before repair.',
      rawLine
    };
  }

  if (/\[SPLIT\]/i.test(trimmed) || /splitting into 2 smaller/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'batch_split',
      severity: 'medium',
      stageHint: stageHint ?? 'extract',
      message: 'Batch split (size or truncation recovery).',
      rawLine
    };
  }

  if (/\[RETRY\]/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'retry',
      severity: 'medium',
      stageHint,
      message: 'Model call retry after transient failure.',
      rawLine
    };
  }

  if (/\[BUDGET\]/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'budget',
      severity: 'high',
      stageHint,
      message: 'Stage budget / cap involved.',
      rawLine
    };
  }

  if (/\[RESUME\]/i.test(trimmed) || /Mid-extraction checkpoint/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'resume_checkpoint',
      severity: 'info',
      stageHint,
      message: 'Resume from checkpoint or mid-pipeline state.',
      rawLine
    };
  }

  if (/max_tokens reached|truncated \(max_tokens/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'truncation',
      severity: 'high',
      stageHint,
      message: 'Output truncated at max_tokens.',
      rawLine
    };
  }

  if (/INTEGRITY\]|grouping claim references collapsed|INGEST_FAIL_ON_GROUPING/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'grouping_integrity',
      severity: 'high',
      stageHint: 'group',
      message: 'Grouping integrity or reference health signal.',
      rawLine
    };
  }

  if (/\[WARN\]/i.test(trimmed) || /^\s*WARN[:\s]/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'warning',
      severity: 'medium',
      stageHint,
      message: 'Warning from worker or model path.',
      rawLine
    };
  }

  if (/source=\s*degraded|degraded_default/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'routing_degraded',
      severity: 'low',
      stageHint,
      message: 'Routing used a degraded or fallback route.',
      rawLine
    };
  }

  return null;
}

export function appendIssueFromLogLine(state: { issues: IngestIssueRecord[] }, line: string): void {
  const nextSeq = state.issues.length;
  const issue = classifyIngestLogLine(line, nextSeq);
  if (!issue) return;
  if (state.issues.length >= MAX_ISSUES_PER_RUN) {
    state.issues.shift();
  }
  issue.seq = state.issues.length;
  state.issues.push(issue);
}

function summarizeIssues(issues: IngestIssueRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) {
    out[i.kind] = (out[i.kind] ?? 0) + 1;
  }
  return out;
}

/** Duck-typed to avoid a circular import with `ingestRuns.ts`. */
export interface IngestRunSnapshotForReport {
  id: string;
  actorEmail?: string;
  status: 'running' | 'awaiting_sync' | 'done' | 'error';
  payload: {
    source_url: string;
    source_type: string;
    validate?: boolean;
    stop_before_store?: boolean;
    model_chain: { extract: string; relate: string; group: string; validate: string };
    embedding_model?: string;
    batch_overrides?: {
      extractionMaxTokensPerSection?: number;
      groupingTargetTokens?: number;
      validationTargetTokens?: number;
      relationsTargetTokens?: number;
      embedBatchSize?: number;
    };
  };
  issues: IngestIssueRecord[];
  logLines: string[];
  error?: string;
  createdAt: number;
  completedAt?: number;
  lastFailureStageKey?: string | null;
  fetchRetryAttempts: number;
  ingestRetryAttempts: number;
  syncRetryAttempts: number;
  cancelledByUser?: boolean;
}

/** Parse last `[INGEST_TIMING] {json}` line from worker stdout (scripts/ingest.ts). */
export function parseIngestTimingFromLogLines(logLines: string[]): Record<string, unknown> | null {
  const prefix = '[INGEST_TIMING]';
  for (let i = logLines.length - 1; i >= 0; i--) {
    const line = (logLines[i] ?? '').trim();
    if (!line.startsWith(prefix)) continue;
    const jsonPart = line.slice(prefix.length).trim();
    try {
      const parsed = JSON.parse(jsonPart) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function summarizeRoutingFromLogLines(logLines: string[]): {
  routeCalls: number;
  routingSources: Record<string, number>;
  orderCounts: Record<string, number>;
  degradedRouteCount: number;
  fallbackUsedCount: number;
} {
  const routingSources: Record<string, number> = {};
  const orderCounts: Record<string, number> = {};
  let routeCalls = 0;
  let degradedRouteCount = 0;
  let fallbackUsedCount = 0;

  for (const line of logLines) {
    const m = line.match(/\[ROUTE\]\s+.*?\s+source=([^\s]+)\s+step=([^\s]+)\s+order=([^\s]+)\s+switch=/i);
    if (!m) continue;
    routeCalls++;

    const source = (m[1] ?? '').trim();
    const orderRaw = (m[3] ?? '').trim();
    if (source) routingSources[source] = (routingSources[source] ?? 0) + 1;
    if (orderRaw) orderCounts[orderRaw] = (orderCounts[orderRaw] ?? 0) + 1;

    if (/degraded/i.test(source)) degradedRouteCount++;
    const orderNum = Number(orderRaw);
    if (Number.isFinite(orderNum) && orderNum >= 1) fallbackUsedCount++;
  }

  return { routeCalls, routingSources, orderCounts, degradedRouteCount, fallbackUsedCount };
}

export async function persistIngestRunReport(state: IngestRunSnapshotForReport): Promise<void> {
  try {
    const ref = adminDb.collection(FIRESTORE_COLLECTION).doc(state.id);
    const payload = state.payload;
    const routingStats = summarizeRoutingFromLogLines(state.logLines);
    const timingTelemetry = parseIngestTimingFromLogLines(state.logLines);
    await ref.set(
      {
        runId: state.id,
        actorEmail: state.actorEmail ?? null,
        status: state.status,
        sourceUrl: payload.source_url,
        sourceType: payload.source_type,
        validate: payload.validate === true,
        stopBeforeStore: payload.stop_before_store !== false,
        modelChain: payload.model_chain,
        embeddingModel: payload.embedding_model ?? null,
        batchOverrides: payload.batch_overrides ?? null,
        routingStats,
        timingTelemetry,
        createdAt: Timestamp.fromMillis(state.createdAt),
        completedAt: Timestamp.fromMillis(state.completedAt ?? Date.now()),
        terminalError: state.error ?? null,
        logLineCount: state.logLines.length,
        issues: state.issues.map((i) => ({
          seq: i.seq,
          ts: i.ts,
          kind: i.kind,
          severity: i.severity,
          stageHint: i.stageHint,
          message: i.message,
          rawLine: i.rawLine
        })),
        issueCount: state.issues.length,
        issueSummary: summarizeIssues(state.issues),
        lastFailureStageKey: state.lastFailureStageKey ?? null,
        fetchRetryAttempts: state.fetchRetryAttempts,
        ingestRetryAttempts: state.ingestRetryAttempts,
        syncRetryAttempts: state.syncRetryAttempts,
        cancelledByUser: state.cancelledByUser === true,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    console.warn(
      '[ingestRunIssues] Failed to persist report:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

/** Row for admin “recent reports” list (Firestore). No TTL in app — retained until you delete docs or set Firestore lifecycle rules. */
export interface IngestRunReportListRow {
  runId: string;
  status: string;
  sourceUrl: string;
  sourceType: string;
  createdAtMs: number;
  completedAtMs: number;
  terminalError: string | null;
  lastFailureStageKey: string | null;
}

export async function listRecentIngestRunReportSummaries(
  limit = 50
): Promise<IngestRunReportListRow[]> {
  const cap = Math.max(1, Math.min(100, limit));
  try {
    const snap = await adminDb
      .collection(FIRESTORE_COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(cap)
      .get();

    return snap.docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      const completedAt = data.completedAt as Timestamp | undefined;
      return {
        runId: typeof data.runId === 'string' ? data.runId : d.id,
        status: typeof data.status === 'string' ? data.status : 'unknown',
        sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
        sourceType: typeof data.sourceType === 'string' ? data.sourceType : '',
        createdAtMs: createdAt?.toMillis?.() ?? 0,
        completedAtMs: completedAt?.toMillis?.() ?? 0,
        terminalError: typeof data.terminalError === 'string' ? data.terminalError : null,
        lastFailureStageKey:
          typeof data.lastFailureStageKey === 'string' ? data.lastFailureStageKey : null
      };
    });
  } catch (e) {
    console.warn(
      '[ingestRunIssues] listRecentIngestRunReportSummaries failed:',
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}
