/**
 * In-memory tracking for ingestion runs spawned from the admin ingest page.
 * Manages background processes and state updates via polling.
 */

import { REASONING_PROVIDER_ORDER } from '@restormel/contracts/providers';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildLocalTsxSpawnArgs, findFetchedSourceFile } from '$lib/server/adminOperations';
import type { IngestionPipelinePreset } from '$lib/ingestionPipelineModelRequirements';
import {
  neonClaimNextQueuedRun,
  neonAppendLogLine,
  neonBumpRunActivity,
  neonCreateIngestRun,
  neonLoadIngestRun,
  neonMergePayloadAndVersion,
  neonPersistIngestRunSnapshot
} from '$lib/server/db/ingestRunRepository';
import { appendIssueFromLogLine, persistIngestRunReport, type IngestIssueRecord } from '$lib/server/ingestRunIssues';
import { buildOperatorByokProcessEnv } from '$lib/server/byok/buildOperatorIngestEnv';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { query as dbQuery } from '$lib/server/db';
import {
  neonHasIngestSourceTextSnapshot,
  neonRestoreSourceTextToDataSources
} from '$lib/server/db/ingestStaging';
import { encodeIngestCatalogRoutingJsonB64 } from '$lib/server/ingestCatalogRouting';
import { resolveEmbeddingFingerprint, resolvePipelineVersion } from '$lib/server/ingestionPipelineMetadata';
import {
  INGEST_PIN_STAGE_SUFFIXES,
  normalizePinnedModelId,
  summarizeIngestPinsForLog
} from './ingestPinNormalization.js';

export { normalizePinnedModelId, summarizeIngestPinsForLog };

/**
 * Preview mode: no Surreal write in the same run (operator syncs later). Default is **full store**
 * in one run (`stop_before_store` omitted or false).
 */
export function ingestOptInStopBeforeStore(payload: { stop_before_store?: boolean }): boolean {
  return payload.stop_before_store === true;
}

export interface IngestRunPayload {
  source_url: string;
  source_type: string;
  validate: boolean;
  /** When true, ingest stops before Surreal store (preview); omit or false for full pipeline including store. */
  stop_before_store?: boolean;
  /** Preferred embedding profile (wizard / Restormel); pipeline may still use server defaults. */
  embedding_model?: string;
  /**
   * Optional per-run batch overrides to reduce rate-limit pressure and improve recovery.
   * These are merged into the child process environment before spawning `scripts/ingest.ts`.
   */
  batch_overrides?: {
    extractionMaxTokensPerSection?: number;
    groupingTargetTokens?: number;
    validationTargetTokens?: number;
    relationsTargetTokens?: number;
    embedBatchSize?: number;
    /** Claim overlap between adjacent relation batches (`scripts/ingest.ts`). */
    relationsBatchOverlapClaims?: number;
    /** Parallel single-passage extraction batches (`INGEST_EXTRACTION_CONCURRENCY`). */
    extractionConcurrency?: number;
    /** When false, disables strict grouping integrity exit (`INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE`). */
    failOnGroupingPositionCollapse?: boolean;
    /** Narrow provider preference for the worker (`INGEST_PROVIDER`). */
    ingestProvider?: 'auto' | 'anthropic' | 'vertex';
    /** When true, worker logs `[INGEST_PINS]` diagnostics (`INGEST_LOG_PINS=1`). */
    ingestLogPins?: boolean;
    /** Per-run model call timeout for most ingest stages (`scripts/ingest.ts` → `INGEST_MODEL_TIMEOUT_MS`). */
    ingestModelTimeoutMs?: number;
    /** Per-run validation-stage default timeout (`VALIDATION_MODEL_TIMEOUT_MS` — fallback when stage env unset). */
    validationModelTimeoutMs?: number;
    /** Per-run validation stage budget timeout (`INGEST_STAGE_VALIDATION_TIMEOUT_MS`). */
    ingestStageValidationTimeoutMs?: number;
    /** Per-run extraction stage timeout override (`INGEST_STAGE_EXTRACTION_TIMEOUT_MS`). */
    ingestStageExtractionTimeoutMs?: number;
    /** Per-run relations stage timeout (`INGEST_STAGE_RELATIONS_TIMEOUT_MS`). */
    ingestStageRelationsTimeoutMs?: number;
    /** Per-run grouping stage timeout (`INGEST_STAGE_GROUPING_TIMEOUT_MS`). */
    ingestStageGroupingTimeoutMs?: number;
    /** Per-run embedding stage timeout (`INGEST_STAGE_EMBEDDING_TIMEOUT_MS`). */
    ingestStageEmbeddingTimeoutMs?: number;
    /** Per-run JSON repair stage timeout (`INGEST_STAGE_JSON_REPAIR_TIMEOUT_MS`). */
    ingestStageJsonRepairTimeoutMs?: number;
  };
  model_chain: {
    extract: string;
    relate: string;
    group: string;
    validate: string;
  };
  /** Recorded in Firestore for analytics (production; legacy values may appear on old runs). */
  pipeline_preset?: IngestionPipelinePreset;
  /** Optional link queue record id for self-serve/nightly promotion flow. */
  queue_record_id?: string;
  /** Optional queue attempt counter carried from link_ingestion_queue. */
  queue_attempt_count?: number;
  /** Durable metadata (auto-filled in createRun when omitted). */
  pipeline_version?: string;
  embedding_fingerprint?: string;
}

function batchOverridesToEnv(
  overrides: IngestRunPayload['batch_overrides'] | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!overrides) return out;

  const {
    extractionMaxTokensPerSection,
    groupingTargetTokens,
    validationTargetTokens,
    relationsTargetTokens,
    embedBatchSize,
    relationsBatchOverlapClaims,
    extractionConcurrency,
    failOnGroupingPositionCollapse,
    ingestProvider,
    ingestLogPins,
    ingestModelTimeoutMs,
    validationModelTimeoutMs,
    ingestStageValidationTimeoutMs,
    ingestStageExtractionTimeoutMs,
    ingestStageRelationsTimeoutMs,
    ingestStageGroupingTimeoutMs,
    ingestStageEmbeddingTimeoutMs,
    ingestStageJsonRepairTimeoutMs
  } = overrides;

  const asPositiveInt = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const n = Math.trunc(v);
    return n > 0 ? n : null;
  };

  const extraction = asPositiveInt(extractionMaxTokensPerSection);
  const grouping = asPositiveInt(groupingTargetTokens);
  const validation = asPositiveInt(validationTargetTokens);
  const relations = asPositiveInt(relationsTargetTokens);
  const embed = asPositiveInt(embedBatchSize);
  const overlap = asPositiveInt(relationsBatchOverlapClaims);
  const extractConc = asPositiveInt(extractionConcurrency);

  if (extraction != null) out.INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION = String(extraction);
  if (grouping != null) out.GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS = String(grouping);
  if (validation != null) out.VALIDATION_BATCH_TARGET_TOKENS = String(validation);
  if (relations != null) out.RELATIONS_BATCH_TARGET_TOKENS = String(relations);
  if (embed != null) out.VERTEX_EMBED_BATCH_SIZE = String(embed);
  if (overlap != null) out.RELATIONS_BATCH_OVERLAP_CLAIMS = String(overlap);
  if (extractConc != null) out.INGEST_EXTRACTION_CONCURRENCY = String(extractConc);
  if (typeof failOnGroupingPositionCollapse === 'boolean') {
    out.INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE = failOnGroupingPositionCollapse ? 'true' : 'false';
  }
  if (ingestProvider === 'auto' || ingestProvider === 'anthropic' || ingestProvider === 'vertex') {
    out.INGEST_PROVIDER = ingestProvider;
  }
  if (typeof ingestLogPins === 'boolean') {
    out.INGEST_LOG_PINS = ingestLogPins ? '1' : '0';
  }

  const ingestTimeout = asPositiveInt(ingestModelTimeoutMs);
  const validationTimeout = asPositiveInt(validationModelTimeoutMs);
  const validationStageTimeout = asPositiveInt(ingestStageValidationTimeoutMs);
  const extractionStageTimeout = asPositiveInt(ingestStageExtractionTimeoutMs);
  if (ingestTimeout != null) out.INGEST_MODEL_TIMEOUT_MS = String(ingestTimeout);
  if (validationTimeout != null) out.VALIDATION_MODEL_TIMEOUT_MS = String(validationTimeout);
  if (validationStageTimeout != null) {
    out.INGEST_STAGE_VALIDATION_TIMEOUT_MS = String(validationStageTimeout);
  }
  if (extractionStageTimeout != null) {
    out.INGEST_STAGE_EXTRACTION_TIMEOUT_MS = String(extractionStageTimeout);
  }

  const relT = asPositiveInt(ingestStageRelationsTimeoutMs);
  const grpT = asPositiveInt(ingestStageGroupingTimeoutMs);
  const embT = asPositiveInt(ingestStageEmbeddingTimeoutMs);
  const jrT = asPositiveInt(ingestStageJsonRepairTimeoutMs);
  if (relT != null) out.INGEST_STAGE_RELATIONS_TIMEOUT_MS = String(relT);
  if (grpT != null) out.INGEST_STAGE_GROUPING_TIMEOUT_MS = String(grpT);
  if (embT != null) out.INGEST_STAGE_EMBEDDING_TIMEOUT_MS = String(embT);
  if (jrT != null) out.INGEST_STAGE_JSON_REPAIR_TIMEOUT_MS = String(jrT);

  return out;
}

function normalizePinProvider(slug: string): string | null {
  const s = slug.toLowerCase().trim();
  if (s === 'google') return 'vertex';
  const allowed = REASONING_PROVIDER_ORDER as readonly string[];
  if (allowed.includes(s)) return s;
  return null;
}

function normalizeEmbeddingProvider(slug: string): 'vertex' | 'voyage' | null {
  const s = slug.toLowerCase().trim();
  if (s === 'google') return 'vertex';
  if (s === 'vertex' || s === 'voyage') return s;
  return null;
}

/**
 * Parses one Expand pipeline value: either `provider · modelId` (display) or
 * `provider__modelId` (stable catalog id from admin `stableModelId()`).
 */
export function parseModelChainLabel(label: string): { providerRaw: string; modelId: string } | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (trimmed.includes('·')) {
    const parts = trimmed.split('·').map((p) => p.trim());
    if (parts.length < 2) return null;
    const providerRaw = parts[0] ?? '';
    const modelId = parts.slice(1).join('·').trim();
    if (!providerRaw || !modelId) return null;
    return { providerRaw, modelId };
  }
  const sep = '__';
  const idx = trimmed.indexOf(sep);
  if (idx > 0) {
    const providerRaw = trimmed.slice(0, idx).trim();
    const modelId = trimmed.slice(idx + sep.length).trim();
    if (!providerRaw || !modelId) return null;
    return { providerRaw, modelId };
  }
  return null;
}

/**
 * Maps Expand UI model labels into worker env vars consumed by
 * `planIngestionStage` so `scripts/ingest.ts` honors operator picks instead of only Restormel auto-routing.
 * Accepts both `provider · modelId` and catalog stable ids `provider__modelId`.
 */
export function modelChainLabelsToEnv(chain: IngestRunPayload['model_chain']): Record<string, string> {
  const out: Record<string, string> = {};
  const apply = (label: string, suffix: string) => {
    const raw = label.trim().toLowerCase();
    if (!raw || raw === 'auto') return;
    const parsed = parseModelChainLabel(label);
    if (!parsed) return;
    const provider = normalizePinProvider(parsed.providerRaw);
    if (!provider) return;
    out[`INGEST_PIN_PROVIDER_${suffix}`] = provider;
    out[`INGEST_PIN_MODEL_${suffix}`] = normalizePinnedModelId(provider, parsed.modelId);
  };
  apply(chain.extract, 'EXTRACTION');
  apply(chain.relate, 'RELATIONS');
  apply(chain.group, 'GROUPING');
  apply(chain.validate, 'VALIDATION');
  return out;
}

function embeddingPreferenceToEnv(embeddingModel: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = embeddingModel?.trim();
  if (!raw) return out;
  const parsed = parseModelChainLabel(raw);
  if (!parsed) return out;
  const provider = normalizeEmbeddingProvider(parsed.providerRaw);
  if (!provider) return out;
  const modelId = normalizePinnedModelId(provider, parsed.modelId);

  if (provider === 'voyage') {
    out.EMBEDDING_PROVIDER = 'voyage';
    out.VOYAGE_DOCUMENT_MODEL = modelId;
    return out;
  }

  if (provider === 'vertex') {
    out.EMBEDDING_PROVIDER = 'vertex';
    return out;
  }

  return out;
}

/**
 * Base64url JSON for `scripts/ingest.ts --ingest-pins-json=…` so operator pins survive
 * dotenv / `--env-file` ordering (see `loadServerEnv` + admin spawn).
 */
export function encodeIngestPinsJsonCliArg(pinEnv: Record<string, string>): string | null {
  const out: Record<string, { provider: string; model: string }> = {};
  for (const s of INGEST_PIN_STAGE_SUFFIXES) {
    const p = pinEnv[`INGEST_PIN_PROVIDER_${s}`]?.trim();
    const m = pinEnv[`INGEST_PIN_MODEL_${s}`]?.trim();
    if (p && m) out[s] = { provider: p, model: m };
  }
  if (Object.keys(out).length === 0) return null;
  return Buffer.from(JSON.stringify(out), 'utf8').toString('base64url');
}

export interface StageStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'skipped';
  summary?: string;
}

/** Lightweight row for admin “all ingestions” list (in-memory only). */
export interface IngestRunSummary {
  id: string;
  status: 'queued' | 'running' | 'awaiting_sync' | 'done' | 'error';
  createdAt: number;
  completedAt?: number;
  sourceUrl: string;
  sourceType: string;
  currentStageKey?: string | null;
  error?: string;
}

export interface IngestRunState {
  id: string;
  status: 'queued' | 'running' | 'awaiting_sync' | 'done' | 'error';
  stages: Record<string, StageStatus>;
  logLines: string[];
  error?: string;
  process?: ChildProcess;
  createdAt: number;
  completedAt?: number;
  /** Snapshot for resume / sync */
  payload: IngestRunPayload;
  sourceFilePath?: string;
  fetchRetryAttempts: number;
  ingestRetryAttempts: number;
  syncRetryAttempts: number;
  syncStartedAt?: number;
  syncCompletedAt?: number;
  currentStageKey?: string | null;
  currentAction?: string | null;
  lastFailureStageKey?: string | null;
  resumable?: boolean;
  lastOutputAt?: number;
  processStartedAt?: number;
  processExitedAt?: number;
  /** When true, child exit handlers must not retry and should finalize as cancelled. */
  cancelledByUser?: boolean;
  /** Simulated pipeline interval (ADMIN_INGEST_RUN_REAL unset). Cleared on cancel or completion. */
  simulationInterval?: ReturnType<typeof setInterval> | null;
  /** Simulated Stage 6 sync timer (real mode uses a child process instead). */
  syncSimulationTimeout?: ReturnType<typeof setTimeout> | null;
  /** Operator email (for durable Firestore reports). */
  actorEmail: string;
  /** Structured signals parsed from worker logs (warnings, repairs, retries, …). */
  issues: IngestIssueRecord[];
  /** Throttle for merging live run state into Firestore `ingestion_run_reports` while still running. */
  lastReportPersistAt?: number;
  /** Durable payload revision (Neon); incremented when resume merges model_chain / batch_overrides. */
  payloadVersion?: number;
}

/** Admin wizard / ingest UI types → `scripts/fetch-source.ts` types. */
function normalizeSourceTypeForFetch(sourceType: string): string {
  const map: Record<string, string> = {
    gutenberg_text: 'book',
    journal_article: 'paper',
    web_article: 'institutional'
  };
  return map[sourceType] ?? sourceType;
}

function ingestRunUsesRealChildProcess(): boolean {
  const v = (process.env.ADMIN_INGEST_RUN_REAL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function neonQueueEnabled(): boolean {
  const raw = (process.env.INGEST_QUEUE_ENABLED ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return ingestRunUsesRealChildProcess() && isNeonIngestPersistenceEnabled();
}

export function inferSourceTypeFromUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (host === 'plato.stanford.edu' || host.endsWith('.plato.stanford.edu')) return 'sep_entry';
    if (host === 'iep.utm.edu' || host.endsWith('.iep.utm.edu')) return 'iep_entry';
    if (host === 'gutenberg.org' || host.endsWith('.gutenberg.org')) return 'book';
    if (pathname.endsWith('.pdf') || host === 'arxiv.org' || host.endsWith('.arxiv.org')) return 'paper';
  } catch {
    // fall through
  }
  return 'institutional';
}

type LinkQueuePromotionRow = {
  id: string;
  canonical_url: string;
  attempt_count?: number;
};

function queueRecordIdPart(recordId: string): string {
  const trimmed = recordId.trim();
  const separator = trimmed.indexOf(':');
  return separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
}

async function markLinkedQueueStatus(
  queueRecordId: string,
  status: 'queued' | 'approved' | 'ingesting' | 'ingested' | 'failed',
  opts?: { lastError?: string | null; ingested?: boolean; attemptCount?: number }
): Promise<void> {
  const idPart = queueRecordIdPart(queueRecordId);
  const hasAttemptCount = typeof opts?.attemptCount === 'number' && Number.isFinite(opts.attemptCount);
  const attemptCount = hasAttemptCount ? Math.max(0, Math.trunc(opts!.attemptCount!)) : 0;
  const hasLastError = typeof opts?.lastError === 'string' && opts.lastError.length > 0;
  await dbQuery(
    `UPDATE type::record('link_ingestion_queue', $id_part) MERGE {
       status: $status,
       updated_at: time::now(),
       attempt_count: if $has_attempt_count then $attempt_count else attempt_count end,
       last_error: if $has_last_error then $last_error else NONE end,
       ingested_at: if $mark_ingested then time::now() else ingested_at end
     }
     RETURN AFTER`,
    {
      id_part: idPart,
      status,
      has_attempt_count: hasAttemptCount,
      attempt_count: attemptCount,
      has_last_error: hasLastError,
      last_error: hasLastError ? opts?.lastError : 'none',
      mark_ingested: opts?.ingested === true
    }
  );
}

export interface IngestExecutionInfo {
  mode: 'simulated' | 'real';
  surrealTarget: string;
  firestoreProject: string | null;
  /** When set, durable ingest orchestration + staging use Neon Postgres (DATABASE_URL). */
  neonIngestPersistence?: boolean;
}

function redactSurrealTarget(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host || rawUrl;
    return `${parsed.protocol}//${host}`;
  } catch {
    return rawUrl;
  }
}

export function getIngestExecutionInfo(): IngestExecutionInfo {
  const mode = ingestRunUsesRealChildProcess() ? 'real' : 'simulated';
  const surrealRaw = (process.env.SURREAL_URL ?? 'http://localhost:8000/rpc').trim();
  const surrealTarget = redactSurrealTarget(surrealRaw || 'http://localhost:8000/rpc');
  const firestoreProject =
    (process.env.FIREBASE_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCLOUD_PROJECT ??
      '').trim() || null;
  return {
    mode,
    surrealTarget,
    firestoreProject,
    neonIngestPersistence: isNeonIngestPersistenceEnabled()
  };
}

function appendProcessOutput(runId: string, chunk: Buffer, manager: IngestRunManager): void {
  const text = chunk.toString('utf-8');
  for (const line of text.split(/\n/)) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.length > 0) manager.addLog(runId, trimmed);
  }
}

/** Lines that usually carry the real reason ingest.ts exited 1 (shown on failRun, not only in log scrollback). */
const INGEST_WORKER_FAILURE_LINE =
  /\[(FATAL ERROR|ERROR)\]|^Error:|\[extraction\]|\[validation\]|\[relations\]|\[grouping\]|Planned route exhausted|timed out after|BUDGET\]|ECONNRESET|ETIMEDOUT|SyntaxError|TypeError|ReferenceError|not_found_error/i;

function extractIngestWorkerFailureHint(logLines: string[], maxLen = 900): string {
  const hits: string[] = [];
  for (let i = logLines.length - 1; i >= 0 && hits.length < 5; i--) {
    const line = logLines[i]?.trim() ?? '';
    if (!line) continue;
    if (INGEST_WORKER_FAILURE_LINE.test(line)) hits.push(line);
  }
  let out = hits.length > 0 ? hits.reverse().join(' | ') : logLines.slice(-4).join(' | ').trim();
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 3)}...`;
  return out;
}

const PIPELINE_STAGES = ['extract', 'relate', 'group', 'embed'] as const;

/** Stages after fetch, in worker order; validate omitted when disabled in payload. */
function orderedStagesAfterFetch(validate: boolean): string[] {
  const out: string[] = [...PIPELINE_STAGES];
  if (validate) out.push('validate');
  out.push('store');
  return out;
}

function stageAliasToKey(value: string | null | undefined): string | null {
  const low = (value ?? '').trim().toLowerCase();
  if (!low) return null;
  if (low.startsWith('fetch')) return 'fetch';
  if (low.startsWith('extract')) return 'extract';
  if (low.startsWith('relat')) return 'relate';
  if (low.startsWith('group')) return 'group';
  if (low.startsWith('embed')) return 'embed';
  if (low.startsWith('validat')) return 'validate';
  if (low.startsWith('stor')) return 'store';
  return null;
}

class IngestRunManager extends EventEmitter {
  private runs: Map<string, IngestRunState> = new Map();
  private maxLogLines = 500;
  private snapshotPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private queuePollTimer: ReturnType<typeof setInterval> | null = null;
  private queuePollBusy = false;
  private queueLinkPromotionBusy = false;

  constructor() {
    super();
    this.startQueuePollingIfEnabled();
  }

  private startQueuePollingIfEnabled(): void {
    if (!neonQueueEnabled()) return;
    if (this.queuePollTimer) return;
    this.queuePollTimer = setInterval(() => {
      void this.pollQueueOnce();
    }, 2000);
    // Kick immediately so newly queued runs begin promptly.
    void this.pollQueueOnce();
  }

  private async pollQueueOnce(): Promise<void> {
    if (!neonQueueEnabled()) return;
    if (this.queuePollBusy) return;
    this.queuePollBusy = true;
    try {
      await this.promoteApprovedLinkQueueRows();
      const raw = (process.env.ADMIN_INGEST_MAX_CONCURRENT ?? '').trim();
      const parsed = parseInt(raw || '3', 10);
      const maxConcurrent = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 3;
      if (this.activeChildProcessCount() >= maxConcurrent) return;

      const claimed = await neonClaimNextQueuedRun();
      if (!claimed) return;
      this.runs.set(claimed.id, claimed);
      this.addLog(claimed.id, '[QUEUE] Claimed queued run for worker execution.');
      this.spawnIngestionProcess(claimed.id, claimed.payload, claimed.actorEmail || 'system');
    } finally {
      this.queuePollBusy = false;
    }
  }

  private async promoteApprovedLinkQueueRows(): Promise<void> {
    if (this.queueLinkPromotionBusy) return;
    const enabled = (process.env.ENABLE_SELF_SERVE_INGESTION_QUEUE ?? 'true').trim().toLowerCase();
    if (enabled === '0' || enabled === 'false' || enabled === 'no') return;
    this.queueLinkPromotionBusy = true;
    try {
      const batchRaw = (process.env.LINK_QUEUE_PROMOTION_BATCH_SIZE ?? '5').trim();
      const batch = Math.max(1, Math.min(20, parseInt(batchRaw, 10) || 5));
      const rows = await dbQuery<LinkQueuePromotionRow[]>(
        `SELECT id, canonical_url, attempt_count, last_submitted_at
         FROM link_ingestion_queue
         WHERE status = 'approved'
           AND (deletion_state = NONE OR deletion_state = 'active')
         ORDER BY last_submitted_at ASC
         LIMIT $limit`,
        { limit: batch }
      );
      if (!Array.isArray(rows) || rows.length === 0) return;

      for (const row of rows) {
        if (!row?.id || !row?.canonical_url) continue;
        const idPart = queueRecordIdPart(row.id);
        const reserve = await dbQuery<Array<{ id: string }>>(
          `UPDATE type::record('link_ingestion_queue', $id_part) SET
             status = 'queued',
             updated_at = time::now(),
             last_error = NONE
           WHERE status = 'approved'
           RETURN AFTER`,
          { id_part: idPart }
        );
        if (!Array.isArray(reserve) || reserve.length === 0) continue;

        try {
          await this.createRun(
            {
              source_url: row.canonical_url,
              source_type: inferSourceTypeFromUrl(row.canonical_url),
              validate: false,
              stop_before_store: false,
              model_chain: {
                extract: 'auto',
                relate: 'auto',
                group: 'auto',
                validate: 'auto'
              },
              queue_record_id: row.id,
              queue_attempt_count: (row.attempt_count ?? 0) + 1
            },
            'self-serve-queue@sophia.local'
          );
        } catch (e) {
          await markLinkedQueueStatus(row.id, 'approved', {
            lastError: e instanceof Error ? e.message : String(e),
            attemptCount: row.attempt_count ?? 0
          });
        }
      }
    } finally {
      this.queueLinkPromotionBusy = false;
    }
  }

  private scheduleNeonSnapshotPersist(runId: string): void {
    if (!isNeonIngestPersistenceEnabled()) return;
    const prev = this.snapshotPersistTimers.get(runId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.snapshotPersistTimers.delete(runId);
      const s = this.runs.get(runId);
      if (s) void neonPersistIngestRunSnapshot(s);
    }, 400);
    this.snapshotPersistTimers.set(runId, t);
  }

  private flushNeonSnapshotPersist(runId: string): void {
    const prev = this.snapshotPersistTimers.get(runId);
    if (prev) clearTimeout(prev);
    this.snapshotPersistTimers.delete(runId);
    const s = this.runs.get(runId);
    if (s && isNeonIngestPersistenceEnabled()) void neonPersistIngestRunSnapshot(s);
  }

  /**
   * Count OS child processes that should consume an ADMIN_INGEST_MAX_CONCURRENT slot.
   * Terminal runs (`done` / `error`) must not count: failed batches stay in `runs` for UI/history
   * and restarts create new run ids — the old ChildProcess can still report `exitCode === null`
   * when the child exited on a signal, which previously inflated this count and blocked restarts.
   */
  private activeChildProcessCount(): number {
    let n = 0;
    for (const s of this.runs.values()) {
      if (s.status === 'done' || s.status === 'error') continue;
      const p = s.process;
      if (!p || p.killed) continue;
      if (typeof p.exitCode === 'number') continue;
      if (p.signalCode) continue;
      n += 1;
    }
    return n;
  }

  async createRun(payload: IngestRunPayload, actorEmail: string): Promise<string> {
    if (ingestRunUsesRealChildProcess() && !neonQueueEnabled()) {
      const raw = (process.env.ADMIN_INGEST_MAX_CONCURRENT ?? '').trim();
      const parsed = parseInt(raw || '3', 10);
      const maxConcurrent = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 3;
      if (this.activeChildProcessCount() >= maxConcurrent) {
        throw new Error(
          `Too many concurrent ingest workers (${maxConcurrent} max). Wait for a run to finish or raise ADMIN_INGEST_MAX_CONCURRENT.`
        );
      }
    }

    const runId = randomBytes(8).toString('hex');
    const initialStatus: IngestRunState['status'] = neonQueueEnabled() ? 'queued' : 'running';
    const snapshot: IngestRunPayload = {
      ...payload,
      stop_before_store: ingestOptInStopBeforeStore(payload),
      pipeline_version: payload.pipeline_version ?? resolvePipelineVersion(),
      embedding_fingerprint: payload.embedding_fingerprint ?? resolveEmbeddingFingerprint()
    };

    const state: IngestRunState = {
      id: runId,
      status: initialStatus,
      stages: {
        fetch: { status: 'idle' },
        extract: { status: 'idle' },
        relate: { status: 'idle' },
        group: { status: 'idle' },
        embed: { status: 'idle' },
        validate: { status: payload.validate ? 'idle' : 'skipped' },
        store: { status: 'idle' }
      },
      logLines: [],
      createdAt: Date.now(),
      payload: snapshot,
      fetchRetryAttempts: 0,
      ingestRetryAttempts: 0,
      syncRetryAttempts: 0,
      currentStageKey: 'fetch',
      currentAction: 'Queued',
      lastFailureStageKey: null,
      resumable: false,
      actorEmail,
      issues: [],
      lastReportPersistAt: undefined,
      payloadVersion: 1
    };

    this.runs.set(runId, state);
    if (isNeonIngestPersistenceEnabled()) {
      try {
        await neonCreateIngestRun(state);
      } catch (e) {
        this.runs.delete(runId);
        throw e;
      }
    }
    if (initialStatus === 'running') {
      this.spawnIngestionProcess(runId, snapshot, actorEmail);
    } else {
      this.addLog(runId, '[QUEUE] Ingest run queued for worker execution.');
      // Same-process kick: Cloud Run may not fire the interval before scale-down; claim promptly.
      void this.pollQueueOnce();
    }
    return runId;
  }

  getState(runId: string): IngestRunState | undefined {
    return this.runs.get(runId);
  }

  /** Loads from Neon when the run is not in this process (e.g. after deploy or cold start). */
  async getStateAsync(runId: string): Promise<IngestRunState | undefined> {
    const mem = this.runs.get(runId);
    if (mem) return mem;
    if (!isNeonIngestPersistenceEnabled()) return undefined;
    const loaded = await neonLoadIngestRun(runId);
    if (loaded) this.runs.set(runId, loaded);
    return loaded ?? undefined;
  }

  /** Newest first. Only runs still held in memory (lost on server restart). */
  listRuns(): IngestRunSummary[] {
    const out: IngestRunSummary[] = [];
    for (const state of this.runs.values()) {
      out.push({
        id: state.id,
        status: state.status,
        createdAt: state.createdAt,
        completedAt: state.completedAt,
        sourceUrl: state.payload.source_url,
        sourceType: state.payload.source_type,
        currentStageKey: state.currentStageKey ?? null,
        error: state.error
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  /**
   * Run Stage 6 after a successful prepare phase (--stop-before-store).
   */
  startSyncToSurreal(runId: string): { ok: true } | { ok: false; error: string } {
    const state = this.runs.get(runId);
    if (!state) {
      return { ok: false, error: 'Run not found.' };
    }
    if (state.status !== 'awaiting_sync') {
      return { ok: false, error: 'Run is not waiting for SurrealDB sync.' };
    }
    if (ingestRunUsesRealChildProcess()) {
      if (!state.sourceFilePath) {
        return { ok: false, error: 'Source file path missing; cannot sync.' };
      }
      state.status = 'running';
      state.syncStartedAt = Date.now();
      state.syncCompletedAt = undefined;
      this.flushNeonSnapshotPersist(runId);
      this.addLog(runId, 'Starting SurrealDB sync (Stage 6)…');
      void this.execStartIngestChild(runId, state.payload, state.sourceFilePath, { forSyncOnly: true });
    } else {
      state.status = 'running';
      state.syncStartedAt = Date.now();
      this.addLog(runId, 'Simulating SurrealDB sync (Stage 6)…');
      this.updateStageStatus(runId, 'store', 'running');
      const syncTimeout = setTimeout(() => {
        const s = this.runs.get(runId);
        if (!s || s.status === 'error' || s.cancelledByUser) return;
        this.updateStageStatus(runId, 'store', 'done');
        this.addLog(runId, 'SurrealDB sync completed successfully.');
        s.syncCompletedAt = Date.now();
        s.syncSimulationTimeout = undefined;
        this.completeRun(runId);
      }, 2200);
      state.syncSimulationTimeout = syncTimeout;
    }
    return { ok: true };
  }

  private schedulePersistReport(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (state.status === 'queued') return;
    void persistIngestRunReport(state);
  }

  addLog(runId: string, line: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.logLines.push(line);
      state.lastOutputAt = Date.now();
      appendIssueFromLogLine(state, line);
      this.ingestProgressFromLogLine(runId, line);
      if (state.logLines.length > this.maxLogLines) {
        state.logLines.shift();
      }
      if (isNeonIngestPersistenceEnabled()) {
        void neonAppendLogLine(runId, line);
        void neonBumpRunActivity(runId, state.lastOutputAt);
        this.scheduleNeonSnapshotPersist(runId);
      }
      // Periodic Firestore merge so overnight failures still leave a durable row (not only in-memory UI).
      if (state.status === 'running' || state.status === 'awaiting_sync') {
        const now = Date.now();
        const raw = (process.env.ADMIN_INGEST_REPORT_PERSIST_INTERVAL_MS ?? '120000').trim();
        const interval = Math.max(30_000, Math.min(60 * 60_000, parseInt(raw, 10) || 120_000));
        if (!state.lastReportPersistAt || now - state.lastReportPersistAt >= interval) {
          state.lastReportPersistAt = now;
          this.schedulePersistReport(runId);
        }
      }
    }
  }

  updateStageStatus(
    runId: string,
    stage: string,
    status: StageStatus['status'],
    summary?: string
  ): void {
    const state = this.runs.get(runId);
    if (state) {
      state.stages[stage] = { status, summary };
      this.scheduleNeonSnapshotPersist(runId);
    }
  }

  completeRun(runId: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.process = undefined;
      state.status = 'done';
      state.completedAt = Date.now();
      state.resumable = false;
      this.flushNeonSnapshotPersist(runId);
      this.schedulePersistReport(runId);
      if (state.payload.queue_record_id) {
        void markLinkedQueueStatus(state.payload.queue_record_id, 'ingested', { ingested: true, lastError: null });
      }
    }
  }

  failRun(runId: string, error: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.process = undefined;
      state.status = 'error';
      state.error = error;
      state.completedAt = Date.now();
      state.lastFailureStageKey = state.currentStageKey ?? state.lastFailureStageKey ?? null;
      state.currentAction = `Failed: ${error}`;
      const rid = state.id;
      state.resumable = Boolean(state.sourceFilePath);
      if (!state.resumable && isNeonIngestPersistenceEnabled()) {
        void neonHasIngestSourceTextSnapshot(rid).then((hasSnap) => {
          const s = this.runs.get(rid);
          if (!s || s.status !== 'error') return;
          if (hasSnap) {
            s.resumable = true;
            this.flushNeonSnapshotPersist(rid);
          }
        });
      }
      this.flushNeonSnapshotPersist(runId);
      this.schedulePersistReport(runId);
      if (state.payload.queue_record_id) {
        void markLinkedQueueStatus(state.payload.queue_record_id, 'failed', { lastError: error });
      }
    }
  }

  private finalizeCancel(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (state.status === 'done' || state.status === 'error') return;

    state.status = 'error';
    state.error = 'Ingestion cancelled by operator.';
    state.completedAt = Date.now();
    state.currentAction = 'Cancelled by operator';
    state.process = undefined;
    // Keep cancellation resumable when a checkpoint source file exists so operators can stop
    // noisy runs and restart from the closest completed stage.
    const rid = state.id;
    state.resumable = Boolean(state.sourceFilePath);
    if (!state.resumable && isNeonIngestPersistenceEnabled()) {
      void neonHasIngestSourceTextSnapshot(rid).then((hasSnap) => {
        const s = this.runs.get(rid);
        if (!s || s.status !== 'error') return;
        if (hasSnap) {
          s.resumable = true;
          this.flushNeonSnapshotPersist(rid);
        }
      });
    }

    for (const key of Object.keys(state.stages)) {
      const st = state.stages[key];
      if (st?.status === 'running') {
        this.updateStageStatus(runId, key, 'error');
      }
    }

    this.addLog(runId, '[CANCEL] Ingestion cancelled by operator.');
    this.flushNeonSnapshotPersist(runId);
    this.schedulePersistReport(runId);
    if (state.payload.queue_record_id) {
      void markLinkedQueueStatus(state.payload.queue_record_id, 'failed', {
        lastError: 'Ingestion cancelled by operator.'
      });
    }
  }

  /**
   * Stop an active run: kill the child process if any, stop simulation timers,
   * or abandon a run that is waiting for SurrealDB sync. Idempotent after terminal state.
   */
  cancelRun(runId: string): { ok: true } | { ok: false; error: string } {
    const state = this.runs.get(runId);
    if (!state) return { ok: false, error: 'Run not found.' };
    if (state.status === 'done' || state.status === 'error') {
      return { ok: false, error: 'Run is not active.' };
    }
    state.cancelledByUser = true;

    if (state.syncSimulationTimeout) {
      clearTimeout(state.syncSimulationTimeout);
      state.syncSimulationTimeout = undefined;
    }

    if (state.simulationInterval) {
      clearInterval(state.simulationInterval);
      state.simulationInterval = undefined;
      this.finalizeCancel(runId);
      return { ok: true };
    }

    if (state.process) {
      try {
        state.process.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      return { ok: true };
    }

    if (state.status === 'awaiting_sync') {
      this.finalizeCancel(runId);
      return { ok: true };
    }

    if (state.status === 'running') {
      this.finalizeCancel(runId);
      return { ok: true };
    }

    return { ok: false, error: 'Unable to cancel run.' };
  }

  async resumeFromFailure(
    runId: string,
    options?: {
      model_chain?: Partial<IngestRunPayload['model_chain']>;
      batch_overrides?: Partial<NonNullable<IngestRunPayload['batch_overrides']>>;
    }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    let state = this.runs.get(runId);
    if (!state && isNeonIngestPersistenceEnabled()) {
      const loaded = await neonLoadIngestRun(runId);
      if (loaded) {
        this.runs.set(runId, loaded);
        state = loaded;
      }
    }
    if (!state) return { ok: false, error: 'Run not found.' };
    if (state.status !== 'error') return { ok: false, error: 'Run is not in a failed state.' };
    if (!state.sourceFilePath) {
      if (!isNeonIngestPersistenceEnabled()) {
        return { ok: false, error: 'No source file checkpoint was found for this run.' };
      }
      try {
        const { txtPath, restored } = await neonRestoreSourceTextToDataSources(state.id);
        if (!restored) {
          return { ok: false, error: 'No source file checkpoint was found for this run.' };
        }
        state.sourceFilePath = txtPath;
        this.flushNeonSnapshotPersist(runId);
      } catch (e) {
        return {
          ok: false,
          error: `Could not restore source from Neon: ${e instanceof Error ? e.message : String(e)}`
        };
      }
    }

    if (options?.model_chain || options?.batch_overrides) {
      let payload: IngestRunPayload = { ...state.payload };
      if (options.model_chain) {
        const mc = options.model_chain;
        payload = {
          ...payload,
          model_chain: {
            extract: mc.extract ?? payload.model_chain.extract,
            relate: mc.relate ?? payload.model_chain.relate,
            group: mc.group ?? payload.model_chain.group,
            validate: mc.validate ?? payload.model_chain.validate
          }
        };
      }
      if (options.batch_overrides) {
        payload = {
          ...payload,
          batch_overrides: { ...(payload.batch_overrides ?? {}), ...options.batch_overrides }
        };
      }
      const nextVersion = (state.payloadVersion ?? 1) + 1;
      state.payload = payload;
      state.payloadVersion = nextVersion;
      void neonMergePayloadAndVersion(runId, payload, nextVersion);
    }

    state.status = 'running';
    state.error = undefined;
    state.completedAt = undefined;
    state.cancelledByUser = false;
    state.currentAction = 'Resuming from previous checkpoint…';
    state.resumable = false;
    this.flushNeonSnapshotPersist(runId);
    this.addLog(
      runId,
      '[RESUME] Restarting ingest.ts from checkpoint. The pipeline will continue from the last completed stage.'
    );
    if (state.payload.queue_record_id) {
      // Keep queue state aligned with checkpoint-resumed runs so operators can see retries in progress.
      void markLinkedQueueStatus(state.payload.queue_record_id, 'ingesting');
    }
    void this.execStartIngestChild(runId, state.payload, state.sourceFilePath, {
      forSyncOnly: false,
      resumeFromFailure: true
    });
    return { ok: true };
  }

  private spawnIngestionProcess(runId: string, payload: IngestRunPayload, actorEmail: string): void {
    const state = this.runs.get(runId);
    if (state && state.status === 'queued') {
      state.status = 'running';
      state.currentAction = 'Dequeued by worker';
      this.flushNeonSnapshotPersist(runId);
    }
    if (payload.queue_record_id) {
      void markLinkedQueueStatus(payload.queue_record_id, 'ingesting', {
        attemptCount: payload.queue_attempt_count
      });
    }

    this.addLog(runId, `Ingestion started by ${actorEmail}`);
    this.addLog(runId, `Source: ${payload.source_url}`);
    this.addLog(runId, `Type: ${payload.source_type}`);
    this.addLog(
      runId,
      `Models: extract=${payload.model_chain.extract}, relate=${payload.model_chain.relate}, group=${payload.model_chain.group}`
    );
    if (payload.validate) {
      this.addLog(runId, `Validation: enabled (model=${payload.model_chain.validate})`);
    }
    if (payload.embedding_model?.trim()) {
      this.addLog(runId, `Embedding preference: ${payload.embedding_model.trim()}`);
    }
    if (ingestOptInStopBeforeStore(payload)) {
      this.addLog(runId, 'SurrealDB store is deferred until you press Sync.');
    }

    if (ingestRunUsesRealChildProcess()) {
      this.addLog(
        runId,
        `Running fetch-source + ingest via local tsx (fetch type: ${normalizeSourceTypeForFetch(payload.source_type)}).`
      );
      this.spawnFetchChild(runId, payload);
    } else {
      this.addLog(
        runId,
        'Simulated pipeline progress. Set ADMIN_INGEST_RUN_REAL=1 to run fetch-source + ingest.ts on the server.'
      );
      this.simulateIngestionProgress(runId, payload);
    }
  }

  private spawnFetchChild(runId: string, payload: IngestRunPayload): void {
    const fetchType = normalizeSourceTypeForFetch(payload.source_type);
    const { command: fetchCmd, args: fetchArgs } = buildLocalTsxSpawnArgs([
      'scripts/fetch-source.ts',
      payload.source_url,
      fetchType
    ]);

    this.updateStageStatus(runId, 'fetch', 'running');
    const fetchChild = spawn(fetchCmd, fetchArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams;

    const runState = this.runs.get(runId);
    if (runState) {
      runState.process = fetchChild;
      runState.processStartedAt = Date.now();
      runState.processExitedAt = undefined;
      runState.currentAction = 'Starting fetch worker (tsx fetch-source)…';
      this.scheduleNeonSnapshotPersist(runId);
    }

    fetchChild.stdout.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));
    fetchChild.stderr.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));

    fetchChild.on('error', (err: Error) => {
      const s = this.runs.get(runId);
      if (s) {
        s.process = undefined;
        s.processExitedAt = Date.now();
      }
      if (s?.cancelledByUser) {
        this.finalizeCancel(runId);
        return;
      }
      this.updateStageStatus(runId, 'fetch', 'error');
      this.failRun(runId, `fetch-source failed to start: ${err.message}`);
    });

    fetchChild.on('close', (code: number | null) => {
      const s = this.runs.get(runId);
      if (s) {
        s.process = undefined;
        s.processExitedAt = Date.now();
      }
      if (s?.cancelledByUser) {
        this.finalizeCancel(runId);
        return;
      }
      if (code !== 0) {
        if (s && s.fetchRetryAttempts < 1) {
          s.fetchRetryAttempts++;
          this.addLog(runId, 'Fetch failed; retrying once automatically…');
          this.updateStageStatus(runId, 'fetch', 'idle');
          this.spawnFetchChild(runId, payload);
          return;
        }
        this.updateStageStatus(runId, 'fetch', 'error');
        this.failRun(runId, `fetch-source exited with code ${code ?? 1}`);
        return;
      }
      this.updateStageStatus(runId, 'fetch', 'done');
      const sourceFile = findFetchedSourceFile(payload.source_url);
      if (!sourceFile) {
        this.failRun(
          runId,
          'fetch-source succeeded but no matching data/sources/*.txt was found for this URL (canonical hash mismatch?).'
        );
        return;
      }
      if (s) s.sourceFilePath = sourceFile;
      void this.execStartIngestChild(runId, payload, sourceFile, { forSyncOnly: false });
    });
  }

  private startIngestChild(
    runId: string,
    payload: IngestRunPayload,
    sourceFile: string,
    options: { forSyncOnly: boolean; resumeFromFailure?: boolean }
  ): void {
    void this.execStartIngestChild(runId, payload, sourceFile, options);
  }

  private async execStartIngestChild(
    runId: string,
    payload: IngestRunPayload,
    sourceFile: string,
    options: { forSyncOnly: boolean; resumeFromFailure?: boolean }
  ): Promise<void> {
    let operatorByokEnv: Record<string, string> = {};
    try {
      operatorByokEnv = await buildOperatorByokProcessEnv();
    } catch (e) {
      console.warn(
        '[ingest-runs] Could not load operator BYOK for ingest worker:',
        e instanceof Error ? e.message : String(e)
      );
    }

    const pinEnvFlat = modelChainLabelsToEnv(payload.model_chain);
    const embeddingEnvOverrides = embeddingPreferenceToEnv(payload.embedding_model);
    const operatorModelPins = Object.keys(pinEnvFlat).length > 0;
    const batchEnvOverrides = {
      ...batchOverridesToEnv(payload.batch_overrides),
      ...embeddingEnvOverrides,
      ...pinEnvFlat,
      ...(operatorModelPins ? { INGEST_NO_MODEL_FALLBACK: '1' } : {})
    };
    const ingestPinsJsonCli = encodeIngestPinsJsonCliArg(pinEnvFlat);
    const forSync = options.forSyncOnly;
    const stopBeforeStore = forSync ? false : ingestOptInStopBeforeStore(payload);
    const orchestrationEnv = isNeonIngestPersistenceEnabled()
      ? { INGEST_ORCHESTRATION_RUN_ID: runId }
      : {};

    let catalogRoutingEnv: Record<string, string> = {};
    if (!operatorModelPins) {
      try {
        const b64 = await encodeIngestCatalogRoutingJsonB64();
        if (b64) {
          catalogRoutingEnv = { INGEST_CATALOG_ROUTING_JSON_B64: b64 };
          this.addLog(
            runId,
            '[ingest] catalog-aware model fallback enabled (Model availability → ingestion-suitable models, cost-ordered)'
          );
        }
      } catch (e) {
        console.warn(
          '[ingest-runs] Could not build INGEST_CATALOG_ROUTING_JSON_B64:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    if (Object.keys(operatorByokEnv).length > 0) {
      this.addLog(
        runId,
        `[ingest] operator BYOK: merged ${Object.keys(operatorByokEnv).join(', ')} into worker env (same bucket as Admin → Operator BYOK)`
      );
    }
    if (Object.keys(embeddingEnvOverrides).length > 0) {
      const provider = embeddingEnvOverrides.EMBEDDING_PROVIDER ?? 'unknown';
      const docModel = embeddingEnvOverrides.VOYAGE_DOCUMENT_MODEL;
      this.addLog(
        runId,
        `[ingest] embedding preference applied: ${provider}${docModel ? `/${docModel}` : ''}`
      );
    }

    if (!forSync) {
      if (options.resumeFromFailure) {
        const st = this.runs.get(runId);
        const failKey = st?.lastFailureStageKey;
        const order = orderedStagesAfterFetch(payload.validate === true);
        const failIdx = failKey ? order.indexOf(failKey) : -1;
        if (st && failIdx >= 0) {
          this.applyPipelineFocusFromLog(runId, failKey!, 'Resuming after failure…');
        } else {
          for (const stage of PIPELINE_STAGES) {
            this.updateStageStatus(runId, stage, 'idle');
          }
          if (payload.validate) {
            this.updateStageStatus(runId, 'validate', 'idle');
          } else {
            this.updateStageStatus(runId, 'validate', 'skipped');
          }
          this.updateStageStatus(runId, 'store', 'idle');
        }
      } else {
        // Only the first ingest stage is active; others stay pending until logs advance focus.
        this.updateStageStatus(runId, 'extract', 'running');
        for (const stage of ['relate', 'group', 'embed'] as const) {
          this.updateStageStatus(runId, stage, 'idle');
        }
        if (payload.validate) {
          this.updateStageStatus(runId, 'validate', 'idle');
        } else {
          this.updateStageStatus(runId, 'validate', 'skipped');
        }
        this.updateStageStatus(runId, 'store', 'idle');
      }
    } else {
      this.updateStageStatus(runId, 'store', 'running');
    }

    let resolvedSourceFile = sourceFile;
    const orchestrationRunId = orchestrationEnv.INGEST_ORCHESTRATION_RUN_ID;
    if (orchestrationRunId) {
      try {
        const absSource = path.isAbsolute(sourceFile)
          ? sourceFile
          : path.resolve(process.cwd(), sourceFile);
        if (!fs.existsSync(absSource)) {
          const { txtPath, restored } = await neonRestoreSourceTextToDataSources(
            orchestrationRunId,
            sourceFile
          );
          if (restored) {
            resolvedSourceFile = txtPath;
            this.addLog(
              runId,
              `[RESUME] Restored source .txt from Neon checkpoint (worker had no local copy) → ${txtPath}`
            );
          }
        }
      } catch (e) {
        this.addLog(
          runId,
          `[WARN] Neon source restore attempt failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const ingestTail: string[] = ['scripts/ingest.ts', resolvedSourceFile];
    if (ingestPinsJsonCli) {
      ingestTail.push(`--ingest-pins-json=${ingestPinsJsonCli}`);
    }
    this.addLog(
      runId,
      `[INGEST_PINS] spawn: model_chain=${summarizeIngestPinsForLog(pinEnvFlat)} flat_env_keys=${Object.keys(pinEnvFlat).length} cli_json=${ingestPinsJsonCli ? `yes(len=${ingestPinsJsonCli.length})` : 'no'}`
    );
    if (payload.validate) ingestTail.push('--validate');
    if (stopBeforeStore) ingestTail.push('--stop-before-store');

    const { command: ingestCmd, args: ingestArgs } = buildLocalTsxSpawnArgs(ingestTail);

    const ingestChild = spawn(ingestCmd, ingestArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...batchEnvOverrides, ...operatorByokEnv, ...orchestrationEnv, ...catalogRoutingEnv },
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams;

    const runState = this.runs.get(runId);
    if (runState) {
      runState.process = ingestChild;
      runState.processStartedAt = Date.now();
      runState.processExitedAt = undefined;
    }

    ingestChild.stdout.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));
    ingestChild.stderr.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));

    ingestChild.on('error', (err: Error) => {
      const s = this.runs.get(runId);
      if (s) {
        s.process = undefined;
        s.processExitedAt = Date.now();
      }
      if (s?.cancelledByUser) {
        this.finalizeCancel(runId);
        return;
      }
      if (forSync) {
        this.updateStageStatus(runId, 'store', 'error');
      } else {
        this.markPipelineStagesError(runId, payload);
      }
      this.failRun(runId, `ingest.ts failed to start: ${err.message}`);
    });

    ingestChild.on('close', (code: number | null) => {
      const s = this.runs.get(runId);
      if (s) {
        s.process = undefined;
        s.processExitedAt = Date.now();
      }

      if (s?.cancelledByUser) {
        this.finalizeCancel(runId);
        return;
      }

      if (code === 0) {
        if (stopBeforeStore) {
          const order = orderedStagesAfterFetch(payload.validate === true);
          for (const key of order) {
            if (key === 'store') {
              this.updateStageStatus(runId, 'store', 'idle');
              continue;
            }
            if (s?.stages[key]?.status === 'skipped') continue;
            this.updateStageStatus(runId, key, 'done');
          }
          if (s) s.status = 'awaiting_sync';
          this.addLog(runId, 'Run phases complete. Press “Sync to SurrealDB” to finish.');
          this.schedulePersistReport(runId);
          return;
        }
        if (forSync) {
          this.updateStageStatus(runId, 'store', 'done');
          this.addLog(runId, 'SurrealDB sync completed successfully.');
          if (s) s.syncCompletedAt = Date.now();
          this.completeRun(runId);
        } else {
          const terminalStages = [
            ...PIPELINE_STAGES,
            ...(payload.validate ? (['validate'] as const) : []),
            'store'
          ] as const;
          for (const stage of terminalStages) {
            this.updateStageStatus(runId, stage, 'done');
          }
          if (!payload.validate) {
            this.updateStageStatus(runId, 'validate', 'skipped');
          }
          this.addLog(runId, 'Ingestion pipeline finished successfully.');
          this.completeRun(runId);
        }
        return;
      }

      if (forSync && s && s.syncRetryAttempts < 1) {
        s.syncRetryAttempts++;
        this.addLog(runId, 'SurrealDB sync failed; retrying once automatically…');
        this.updateStageStatus(runId, 'store', 'running');
        void this.execStartIngestChild(runId, payload, sourceFile, { forSyncOnly: true });
        return;
      }

      if (!forSync && s && s.ingestRetryAttempts < 1) {
        s.ingestRetryAttempts++;
        this.addLog(runId, 'Ingest failed; retrying once automatically…');
        void this.execStartIngestChild(runId, payload, sourceFile, {
          forSyncOnly: false,
          resumeFromFailure: true
        });
        return;
      }

      if (forSync) {
        this.updateStageStatus(runId, 'store', 'error');
        const hint = s ? extractIngestWorkerFailureHint(s.logLines) : '';
        this.failRun(
          runId,
          hint
            ? `SurrealDB sync (ingest.ts) exited with code ${code ?? 1} — ${hint}`
            : `SurrealDB sync (ingest.ts) exited with code ${code ?? 1}`
        );
      } else {
        const order = orderedStagesAfterFetch(payload.validate === true);
        const failKey = s?.lastFailureStageKey;
        const failIdx = failKey ? order.indexOf(failKey) : -1;
        if (s && failIdx >= 0) {
          for (let i = 0; i < failIdx; i++) {
            const k = order[i]!;
            if (s.stages[k]?.status === 'skipped') continue;
            this.updateStageStatus(runId, k, 'done');
          }
          if (s.stages[failKey!]?.status !== 'skipped') {
            this.updateStageStatus(runId, failKey!, 'error');
          }
          for (let i = failIdx + 1; i < order.length; i++) {
            const k = order[i]!;
            if (k === 'store' && ingestOptInStopBeforeStore(payload)) {
              this.updateStageStatus(runId, 'store', 'idle');
              continue;
            }
            if (s.stages[k]?.status === 'skipped') continue;
            this.updateStageStatus(runId, k, 'idle');
          }
        } else {
          const terminalStages = [
            ...PIPELINE_STAGES,
            ...(payload.validate ? (['validate'] as const) : []),
            'store'
          ] as const;
          for (const stage of terminalStages) {
            this.updateStageStatus(runId, stage, 'error');
          }
        }
        const hint = s ? extractIngestWorkerFailureHint(s.logLines) : '';
        this.failRun(
          runId,
          hint
            ? `ingest.ts exited with code ${code ?? 1} — ${hint}`
            : `ingest.ts exited with code ${code ?? 1}`
        );
      }
    });
  }

  /**
   * Keep a single "running" stage among extract→…→store: prior stages done, later stages idle/skipped.
   */
  private applyPipelineFocusFromLog(runId: string, activeKey: string, summaryLine: string): void {
    const state = this.runs.get(runId);
    if (!state) return;

    const stopBeforeStore = ingestOptInStopBeforeStore(state.payload);
    const validateOn = state.payload.validate === true;
    const order = orderedStagesAfterFetch(validateOn);
    const idx = order.indexOf(activeKey);

    if (idx === -1) {
      return;
    }

    state.currentStageKey = activeKey;
    state.currentAction = summaryLine;

    for (let i = 0; i < idx; i++) {
      const k = order[i];
      if (state.stages[k]?.status === 'skipped') continue;
      if (k === 'store' && stopBeforeStore) continue;
      this.updateStageStatus(runId, k, 'done');
    }

    if (state.stages[activeKey]?.status !== 'skipped') {
      this.updateStageStatus(runId, activeKey, 'running', summaryLine);
    }

    for (let i = idx + 1; i < order.length; i++) {
      const k = order[i];
      if (state.stages[k]?.status === 'skipped') continue;
      if (k === 'store' && stopBeforeStore) {
        this.updateStageStatus(runId, 'store', 'idle');
        continue;
      }
      const st = state.stages[k]?.status;
      if (st === 'done' || st === 'error' || (st as string) === 'skipped') continue;
      this.updateStageStatus(runId, k, 'idle');
    }
  }

  private ingestProgressFromLogLine(runId: string, rawLine: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    const line = rawLine.trim();
    if (!line) return;

    // fetch-source.ts logs `[FETCH] …` (not `STAGE 1: …`); without this the UI stays on "Queued".
    if (/^\[FETCH\]/i.test(line)) {
      state.currentStageKey = 'fetch';
      state.currentAction = line;
      if (state.stages.fetch?.status !== 'done') {
        this.updateStageStatus(runId, 'fetch', 'running', line);
      }
      return;
    }

    const stageHeader = line.match(/STAGE\s+\d+:\s*([A-Z ]+)/i);
    const routeStage = line.match(/\[ROUTE\]\s+([a-z_]+)/i);
    const retryStage = line.match(/\[RETRY\]\s+([a-z_]+)/i);
    const costStage = line.match(/\[COST\]\s+([A-Z_]+)/i);
    const actionStage = stageHeader?.[1] ?? routeStage?.[1] ?? retryStage?.[1] ?? costStage?.[1] ?? null;
    const stageKey = stageAliasToKey(actionStage);

    if (stageKey) {
      if (stageKey === 'fetch') {
        state.currentStageKey = 'fetch';
        state.currentAction = line;
        if (state.stages.fetch?.status !== 'done') {
          this.updateStageStatus(runId, 'fetch', 'running', line);
        }
        return;
      }
      this.applyPipelineFocusFromLog(runId, stageKey, line);
    } else if (
      /\[RESUME\]/i.test(line) ||
      /\[PHASE\]/i.test(line) ||
      /\[WARN\]/i.test(line) ||
      /\[BUDGET\]/i.test(line) ||
      /\[SAVE\]/i.test(line) ||
      /\[COST\]/i.test(line)
    ) {
      state.currentAction = line;
    }

    if (/failed|error|exited with code/i.test(line)) {
      state.lastFailureStageKey = stageKey ?? state.currentStageKey ?? state.lastFailureStageKey ?? null;
    }
  }

  private markPipelineStagesError(runId: string, payload: IngestRunPayload): void {
    for (const stage of PIPELINE_STAGES) {
      this.updateStageStatus(runId, stage, 'error');
    }
    if (payload.validate) {
      this.updateStageStatus(runId, 'validate', 'error');
    }
    this.updateStageStatus(runId, 'store', 'error');
  }

  private simulateIngestionProgress(runId: string, payload: IngestRunPayload): void {
    const stopBeforeStore = ingestOptInStopBeforeStore(payload);
    const stages = [
      'fetch',
      ...PIPELINE_STAGES,
      payload.validate ? 'validate' : null,
      ...(stopBeforeStore ? [] : ['store'])
    ].filter(Boolean) as string[];
    let stageIndex = 0;

    const progressInterval = setInterval(() => {
      const state = this.runs.get(runId);
      if (!state) {
        clearInterval(progressInterval);
        return;
      }
      if (state.cancelledByUser) {
        clearInterval(progressInterval);
        state.simulationInterval = undefined;
        return;
      }

      if (stageIndex < stages.length) {
        const stage = stages[stageIndex];

        if (stageIndex > 0) {
          const prevStage = stages[stageIndex - 1];
          this.updateStageStatus(runId, prevStage, 'done');
        }

        this.updateStageStatus(runId, stage, 'running');
        this.addLog(runId, `Starting stage: ${stage}`);

        const duration = Math.random() * 3000 + 2000;
        setTimeout(() => {
          stageIndex++;
        }, duration);
      } else {
        for (const stage of stages) {
          if (state.stages[stage]?.status === 'running') {
            this.updateStageStatus(runId, stage, 'done');
          }
        }
        if (stopBeforeStore) {
          this.updateStageStatus(runId, 'store', 'idle');
          if (!payload.validate) {
            this.updateStageStatus(runId, 'validate', 'skipped');
          }
          state.status = 'awaiting_sync';
          this.addLog(runId, 'Run phases complete. Press “Sync to SurrealDB” to finish.');
          this.schedulePersistReport(runId);
        } else {
          this.addLog(runId, 'All stages complete!');
          this.completeRun(runId);
        }
        clearInterval(progressInterval);
        state.simulationInterval = undefined;
      }
    }, 1000);

    const runState = this.runs.get(runId);
    if (runState) runState.simulationInterval = progressInterval;
  }
}

export const ingestRunManager = new IngestRunManager();
