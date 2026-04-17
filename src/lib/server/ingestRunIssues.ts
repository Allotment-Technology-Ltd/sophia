/**
 * Classifies ingestion worker log lines into structured issues for review and Firestore retention.
 * Pairs with `ingestRuns.ts` (in-memory) and `ingestion_run_reports` in Firestore (durable).
 */

import { FieldValue, Timestamp } from '$lib/server/fsCompat';
import {
  neonAppendIssue,
  neonListRecentReportRows,
  neonMirrorIngestReportDocument,
  neonSetReportEnvelope
} from '$lib/server/db/ingestRunRepository';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { parseIngestSelfHealLine } from '$lib/server/ingestion/selfHealLog';
import {
  buildIngestMetricsAdvisory,
  scanLogLinesForIngestSignals
} from '$lib/server/ingestion/ingestRunMetricsAdvisor';

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
  | 'recovery_agent'
  | 'circuit_open'
  | 'stage_health_bump'
  | 'watchdog'
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
  const selfHeal = parseIngestSelfHealLine(line);
  if (selfHeal?.stage) return selfHeal.stage;

  const low = line.toLowerCase();
  if (/\[resume\]/i.test(line)) {
    if (/mid-?grouping|grouping checkpoint|stage\s*3/i.test(low)) return 'group';
    if (/mid-?embed|embedding checkpoint|stage\s*4/i.test(low)) return 'embed';
    if (/validat/i.test(low)) return 'validate';
    if (/relat/i.test(low)) return 'relate';
    if (/extract|passage|stage\s*1/i.test(low)) return 'extract';
    if (/store|sync|surreal|stage\s*6/i.test(low)) return 'store';
    return 'resume';
  }

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
    if (s.includes('json') || s.includes('repair')) return 'json_repair';
    return s;
  }
  return null;
}

const WARN_MESSAGE_MAX = 280;

/** One-line summary for operator-visible issue rows (avoid generic copy when the log line is informative). */
function summarizeWorkerLineForIssueMessage(prefix: string, rawLine: string): string {
  const t = rawLine.trim();
  const stripped = t.replace(/^\s*\[(?:WARN|RETRY|BUDGET|FIX|SPLIT|RESUME|INFO)\]\s*/i, '').trim();
  const body = (stripped || t).slice(0, WARN_MESSAGE_MAX);
  return body.length ? `${prefix}: ${body}` : prefix;
}

/**
 * Returns a structured issue when the line is worth recording; otherwise null.
 */
export function classifyIngestLogLine(line: string, seq: number): IngestIssueRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('[INGEST_TELEMETRY]') || trimmed.startsWith('[WATCHDOG]')) {
    return null;
  }
  if (trimmed.startsWith('[SKIP]')) {
    return null;
  }

  const selfHeal = parseIngestSelfHealLine(trimmed);
  if (selfHeal) {
    const stageHint = selfHeal.stage ?? inferStageFromLine(trimmed);
    const rawLine = truncateLine(trimmed);
    const parts = [
      selfHeal.signal,
      selfHeal.outcome && `outcome=${selfHeal.outcome}`,
      selfHeal.provider && selfHeal.model && `${selfHeal.provider}/${selfHeal.model}`,
      selfHeal.detail
    ].filter(Boolean);
    const baseMessage = parts.join(' — ');
    if (selfHeal.signal === 'recovery_agent') {
      return {
        seq,
        ts: Date.now(),
        kind: 'recovery_agent',
        severity: 'medium',
        stageHint,
        message: baseMessage || 'Recovery agent signal.',
        rawLine
      };
    }
    if (selfHeal.signal === 'circuit_open') {
      return {
        seq,
        ts: Date.now(),
        kind: 'circuit_open',
        severity: 'high',
        stageHint,
        message: baseMessage || 'Circuit open or tier skipped.',
        rawLine
      };
    }
    return {
      seq,
      ts: Date.now(),
      kind: 'stage_health_bump',
      severity: 'low',
      stageHint,
      message: baseMessage || 'Stage-scoped model health update.',
      rawLine
    };
  }

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
      message: summarizeWorkerLineForIssueMessage('Ingest retry from checkpoint', rawLine),
      rawLine
    };
  }

  if (/\[FIX\]|Repair route:/i.test(trimmed) || /Attempting fix/i.test(trimmed)) {
    return {
      seq,
      ts: Date.now(),
      kind: 'json_repair',
      severity: 'medium',
      stageHint: stageHint ?? 'json_repair',
      message: summarizeWorkerLineForIssueMessage('JSON repair engaged', rawLine),
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
      message: summarizeWorkerLineForIssueMessage('Parse or schema validation failed', rawLine),
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
      message: summarizeWorkerLineForIssueMessage('Batch split', rawLine),
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
      message: summarizeWorkerLineForIssueMessage('Model retry', rawLine),
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
      message: summarizeWorkerLineForIssueMessage('Stage budget', rawLine),
      rawLine
    };
  }

  if (/\[RESUME\]/i.test(trimmed) || /Mid-extraction checkpoint/i.test(trimmed)) {
    // Narrative lines duplicated by stronger resume signals (load / no-checkpoint / rollback).
    if (/^\[RESUME\]\s*Previous status:/i.test(trimmed)) return null;
    if (/^\[RESUME\]\s*Last completed stage:/i.test(trimmed)) return null;
    return {
      seq,
      ts: Date.now(),
      kind: 'resume_checkpoint',
      severity: 'info',
      stageHint,
      message: summarizeWorkerLineForIssueMessage('Resume checkpoint', rawLine),
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
      message: summarizeWorkerLineForIssueMessage('Worker warning', rawLine),
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

export function appendIssueFromLogLine(
  state: { id: string; issues: IngestIssueRecord[] },
  line: string
): void {
  const nextSeq = state.issues.length;
  const issue = classifyIngestLogLine(line, nextSeq);
  if (!issue) return;
  const last = state.issues[state.issues.length - 1];
  if (
    last &&
    last.kind === issue.kind &&
    last.message === issue.message &&
    last.stageHint === issue.stageHint &&
    issue.ts - last.ts < 30_000
  ) {
    return;
  }
  if (state.issues.length >= MAX_ISSUES_PER_RUN) {
    state.issues.shift();
  }
  issue.seq = state.issues.length;
  state.issues.push(issue);
  if (isNeonIngestPersistenceEnabled()) void neonAppendIssue(state.id, issue);
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
  status: 'queued' | 'running' | 'awaiting_sync' | 'awaiting_promote' | 'done' | 'error';
  payload: {
    source_url: string;
    source_type: string;
    validate?: boolean;
    stop_before_store?: boolean;
    stop_after_extraction?: boolean;
    pipeline_version?: string;
    embedding_fingerprint?: string;
    pipeline_preset?: 'production' | 'budget' | 'balanced' | 'complexity';
    model_chain: {
      extract: string;
      relate: string;
      group: string;
      validate: string;
      remediate: string;
      json_repair: string;
    };
    embedding_model?: string;
    batch_overrides?: {
      extractionMaxTokensPerSection?: number;
      groupingTargetTokens?: number;
      validationTargetTokens?: number;
      relationsTargetTokens?: number;
      embedBatchSize?: number;
      embedBatchDelayMs?: number;
      ingestModelTimeoutMs?: number;
      validationModelTimeoutMs?: number;
      ingestStageValidationTimeoutMs?: number;
      ingestStageExtractionTimeoutMs?: number;
      ingestStageRelationsTimeoutMs?: number;
      ingestStageGroupingTimeoutMs?: number;
      ingestStageEmbeddingTimeoutMs?: number;
      ingestStageJsonRepairTimeoutMs?: number;
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

function summarizeSelfHealFromIssues(issues: IngestIssueRecord[]): {
  recovery_agent: number;
  circuit_open: number;
  stage_health_bump: number;
} {
  let recovery_agent = 0;
  let circuit_open = 0;
  let stage_health_bump = 0;
  for (const i of issues) {
    if (i.kind === 'recovery_agent') recovery_agent += 1;
    if (i.kind === 'circuit_open') circuit_open += 1;
    if (i.kind === 'stage_health_bump') stage_health_bump += 1;
  }
  return { recovery_agent, circuit_open, stage_health_bump };
}

function buildIngestRunReportEnvelope(state: IngestRunSnapshotForReport): Record<string, unknown> {
  const payload = state.payload;
  const routingStats = summarizeRoutingFromLogLines(state.logLines);
  const timingTelemetry = parseIngestTimingFromLogLines(state.logLines);
  const issueSelfHealSummary = summarizeSelfHealFromIssues(state.issues);
  const selfHealTelemetry = {
    recoveryAgentInvocations:
      typeof timingTelemetry?.recovery_agent_invocations === 'number'
        ? timingTelemetry.recovery_agent_invocations
        : null,
    recoveryAgentBackoffMsTotal:
      typeof timingTelemetry?.recovery_agent_backoff_ms_total === 'number'
        ? timingTelemetry.recovery_agent_backoff_ms_total
        : null,
    issueSelfHealSummary
  };
  const logSignals = scanLogLinesForIngestSignals(state.logLines);
  const metricsAdvisory = buildIngestMetricsAdvisory(timingTelemetry, logSignals);
  return {
    runId: state.id,
    actorEmail: state.actorEmail ?? null,
    status: state.status,
    sourceUrl: payload.source_url,
    sourceType: payload.source_type,
    pipelinePreset: payload.pipeline_preset ?? null,
    validate: payload.validate === true,
    stopBeforeStore: payload.stop_before_store !== false,
    stopAfterExtraction: payload.stop_after_extraction === true,
    pipelineVersion: payload.pipeline_version ?? null,
    embeddingFingerprint: payload.embedding_fingerprint ?? null,
    modelChain: payload.model_chain,
    embeddingModel: payload.embedding_model ?? null,
    batchOverrides: payload.batch_overrides ?? null,
    routingStats,
    timingTelemetry,
    selfHealTelemetry,
    metricsAdvisory,
    createdAtMs: state.createdAt,
    completedAtMs: state.completedAt ?? Date.now(),
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
    updatedAtMs: Date.now()
  };
}

export async function persistIngestRunReport(state: IngestRunSnapshotForReport): Promise<void> {
  try {
    const envelope = buildIngestRunReportEnvelope(state);
    if (isNeonIngestPersistenceEnabled()) {
      await neonSetReportEnvelope(state.id, envelope);
      await neonMirrorIngestReportDocument(state.id, envelope);
      return;
    }

    const ref = sophiaDocumentsDb.collection(FIRESTORE_COLLECTION).doc(state.id);
    await ref.set(
      {
        runId: envelope.runId,
        actorEmail: envelope.actorEmail,
        status: envelope.status,
        sourceUrl: envelope.sourceUrl,
        sourceType: envelope.sourceType,
        pipelinePreset: envelope.pipelinePreset,
        validate: envelope.validate,
        stopBeforeStore: envelope.stopBeforeStore,
        stopAfterExtraction: envelope.stopAfterExtraction,
        pipelineVersion: envelope.pipelineVersion,
        embeddingFingerprint: envelope.embeddingFingerprint,
        modelChain: envelope.modelChain,
        embeddingModel: envelope.embeddingModel,
        batchOverrides: envelope.batchOverrides,
        routingStats: envelope.routingStats,
        timingTelemetry: envelope.timingTelemetry,
        selfHealTelemetry: envelope.selfHealTelemetry,
        metricsAdvisory: envelope.metricsAdvisory,
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
    if (isNeonIngestPersistenceEnabled()) {
      return neonListRecentReportRows(cap);
    }

    const snap = await sophiaDocumentsDb
      .collection(FIRESTORE_COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(cap)
      .get();

    return snap.docs.map((d) => {
      const data = d.data() ?? {};
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
