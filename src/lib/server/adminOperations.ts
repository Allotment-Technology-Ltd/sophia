import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { FieldValue, Timestamp } from '$lib/server/fsCompat';
import { z } from 'zod';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { query as surrealQuery } from '$lib/server/db';
import {
	buildSourceUrlFetchCandidates,
	canonicalizeAndHashSourceUrl
} from '$lib/server/sourceIdentity';
import type { AdminActor } from '$lib/server/adminAccess';

const ADMIN_OPERATIONS_COLLECTION = 'admin_operations';
const OPERATION_LIMIT_DEFAULT = 25;
const OPERATION_LIMIT_MAX = 100;
const STALE_RUNNING_THRESHOLD_MS = Number(process.env.ADMIN_OPERATION_STALE_MS || '300000');

const INGEST_SOURCE_TYPES = ['sep_entry', 'iep_entry', 'book', 'paper', 'institutional'] as const;
const INGEST_STAGES = ['extracting', 'relating', 'grouping', 'embedding', 'validating', 'storing'] as const;
const SAFE_INGEST_MODES = ['local-then-migrate', 'direct-prod'] as const;

export const ADMIN_OPERATION_KINDS = [
  'ingest_import',
  'validate',
  'diagnose_doctor',
  'replay_reingest',
  'repair_finalize',
  'sync_to_surreal'
] as const;

export const ADMIN_OPERATION_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'sync_failed',
  'validation_failed'
] as const;

export type AdminOperationKind = typeof ADMIN_OPERATION_KINDS[number];
export type AdminOperationStatus = typeof ADMIN_OPERATION_STATUSES[number];

const IngestImportPayloadSchema = z.object({
  source_url: z.string().url().optional(),
  source_type: z.enum(INGEST_SOURCE_TYPES).optional(),
  source_file: z.string().min(1).optional(),
  validate: z.boolean().optional(),
  ingest_provider: z.enum(['vertex', 'anthropic']).optional(),
  restormel_ingest_route_id: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
}).superRefine((value, ctx) => {
  if (!value.source_url && !value.source_file) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'source_url or source_file is required'
    });
  }
  if (value.source_url && !value.source_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'source_type is required when source_url is provided'
    });
  }
});

const ValidatePayloadSchema = z.object({
  scope: z.enum(['restormel', 'surreal', 'full']).default('full'),
  source_url: z.string().url().optional(),
  canonical_url_hash: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

const DiagnoseDoctorPayloadSchema = z.object({
  scope: z.enum(['restormel', 'ingestion', 'full']).default('full'),
  blocked_model_id: z.string().min(1).optional(),
  blocked_provider_type: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

const ReplayReingestPayloadSchema = z.object({
  canonical_url_hash: z.string().min(1),
  force_stage: z.enum(INGEST_STAGES).optional(),
  ingest_provider: z.enum(['vertex', 'anthropic']).optional(),
  domain: z.string().min(1).optional(),
  validate: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

const RepairFinalizePayloadSchema = z.object({
  source_file: z.string().min(1),
  mode: z.enum(SAFE_INGEST_MODES).default('local-then-migrate'),
  force_migrate: z.boolean().optional(),
  allow_local_reingest: z.boolean().optional(),
  confirm_direct_prod: z.boolean().optional(),
  skip_backup: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

const SyncToSurrealPayloadSchema = z.object({
  source_url: z.string().url().optional(),
  canonical_url_hash: z.string().min(1).optional(),
  require_claims: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  notes: z.string().max(2000).optional()
}).superRefine((value, ctx) => {
  if (!value.source_url && !value.canonical_url_hash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'source_url or canonical_url_hash is required'
    });
  }
});

export const AdminOperationRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ingest_import'), payload: IngestImportPayloadSchema }),
  z.object({ kind: z.literal('validate'), payload: ValidatePayloadSchema }),
  z.object({ kind: z.literal('diagnose_doctor'), payload: DiagnoseDoctorPayloadSchema }),
  z.object({ kind: z.literal('replay_reingest'), payload: ReplayReingestPayloadSchema }),
  z.object({ kind: z.literal('repair_finalize'), payload: RepairFinalizePayloadSchema }),
  z.object({ kind: z.literal('sync_to_surreal'), payload: SyncToSurrealPayloadSchema })
]);

export type AdminOperationRequest = z.infer<typeof AdminOperationRequestSchema>;
export type AdminOperationPayload = AdminOperationRequest['payload'];

export interface AdminOperationRecord {
  id: string;
  kind: AdminOperationKind;
  status: AdminOperationStatus;
  payload: Record<string, unknown>;
  requested_by_uid: string;
  requested_by_email: string | null;
  attempts: number;
  requested_action: string;
  executor: 'restormel_api' | 'restormel_cli' | 'sophia_adapter';
  restormel_tool: string | null;
  hosted_run_id: string | null;
  validation_status: 'pending' | 'passed' | 'failed' | 'skipped';
  sync_status: 'pending' | 'passed' | 'failed' | 'skipped';
  result_summary: string | null;
  last_error: string | null;
  log_text: string;
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_requested: boolean;
}

type AdminOperationDoc = Omit<AdminOperationRecord, 'id' | 'created_at' | 'updated_at' | 'started_at' | 'completed_at' | 'cancelled_at'> & {
  created_at: Timestamp;
  updated_at: Timestamp;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
};

const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const processingPromises = new Map<string, Promise<void>>();

function operationsCollection() {
  return sophiaDocumentsDb.collection(ADMIN_OPERATIONS_COLLECTION);
}

function toIso(value: Timestamp | null | undefined): string | null {
  return value?.toDate?.()?.toISOString() ?? null;
}

/** Firestore/Neon docs must store `status`, but legacy or partial rows may omit it — avoid defaulting to `failed`. */
function coerceAdminOperationStatus(data: Partial<AdminOperationDoc> | undefined): AdminOperationStatus {
  const raw = data?.status;
  if (typeof raw === 'string' && (ADMIN_OPERATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as AdminOperationStatus;
  }
  if (data?.completed_at && data?.cancelled_at) {
    return 'cancelled';
  }
  if (data?.completed_at) {
    return data?.last_error ? 'failed' : 'succeeded';
  }
  if (data?.started_at) {
    return 'running';
  }
  return 'queued';
}

function serializeOperation(
  id: string,
  data: Partial<AdminOperationDoc> | undefined
): AdminOperationRecord {
  return {
    id,
    kind: (data?.kind as AdminOperationKind) ?? 'validate',
    status: coerceAdminOperationStatus(data),
    payload: (data?.payload as Record<string, unknown>) ?? {},
    requested_by_uid: data?.requested_by_uid ?? 'unknown',
    requested_by_email: data?.requested_by_email ?? null,
    attempts: data?.attempts ?? 0,
    requested_action: data?.requested_action ?? 'unknown',
    executor: (data?.executor as AdminOperationRecord['executor']) ?? 'sophia_adapter',
    restormel_tool: data?.restormel_tool ?? null,
    hosted_run_id: data?.hosted_run_id ?? null,
    validation_status: data?.validation_status ?? 'pending',
    sync_status: data?.sync_status ?? 'pending',
    result_summary: data?.result_summary ?? null,
    last_error: data?.last_error ?? null,
    log_text: data?.log_text ?? '',
    created_at: toIso(data?.created_at ?? null),
    updated_at: toIso(data?.updated_at ?? null),
    started_at: toIso(data?.started_at ?? null),
    completed_at: toIso(data?.completed_at ?? null),
    cancelled_at: toIso(data?.cancelled_at ?? null),
    cancel_requested: Boolean(data?.cancel_requested)
  };
}

function resolveRequestedAction(kind: AdminOperationKind): string {
  switch (kind) {
    case 'ingest_import':
      return 'Ingest / import source';
    case 'validate':
      return 'Validate Restormel and Surreal state';
    case 'diagnose_doctor':
      return 'Run Restormel doctor / diagnostics';
    case 'replay_reingest':
      return 'Replay / reingest source';
    case 'repair_finalize':
      return 'Repair / finalize ingestion';
    case 'sync_to_surreal':
      return 'Verify sync to Surreal';
  }
}

function defaultExecutor(kind: AdminOperationKind): AdminOperationRecord['executor'] {
  if (kind === 'validate' || kind === 'diagnose_doctor') {
    return 'restormel_cli';
  }
  return 'sophia_adapter';
}

function defaultRestormelTool(kind: AdminOperationKind): string | null {
  switch (kind) {
    case 'validate':
      return '@restormel/validate';
    case 'diagnose_doctor':
      return '@restormel/doctor';
    default:
      return null;
  }
}

/** Shared with `ingestRuns` for `tsx --env-file=…` CLI args (see `buildLocalTsxSpawnArgs`). */
export function buildEnvFileArgs(): string[] {
  const args: string[] = [];
  if (fs.existsSync(path.resolve(process.cwd(), '.env'))) args.push('--env-file=.env');
  if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) args.push('--env-file=.env.local');
  return args;
}

/**
 * Spawn tsx via `node_modules/.bin/tsx` (or `tsx.cmd` on Windows) so admin ingest does not run
 * `npx tsx` (slow / silent while npx resolves). Falls back to `pnpm exec tsx` if the bin is missing.
 */
export function buildLocalTsxSpawnArgs(scriptAndRest: string[]): { command: string; args: string[] } {
  const cwd = process.cwd();
  const envArgs = buildEnvFileArgs();
  const args = [...envArgs, ...scriptAndRest];
  const winCmd = path.join(cwd, 'node_modules', '.bin', 'tsx.cmd');
  const unixBin = path.join(cwd, 'node_modules', '.bin', 'tsx');
  if (process.platform === 'win32' && fs.existsSync(winCmd)) {
    return { command: winCmd, args };
  }
  if (fs.existsSync(unixBin)) {
    return { command: unixBin, args };
  }
  return { command: 'pnpm', args: ['exec', 'tsx', ...args] };
}

function normalizeTextFilePath(sourceFile: string): string {
  return path.isAbsolute(sourceFile) ? sourceFile : path.resolve(process.cwd(), sourceFile);
}

export function findFetchedSourceFile(sourceUrl: string): string | null {
  const targetIdentity = canonicalizeAndHashSourceUrl(sourceUrl);
  if (!targetIdentity) return null;
  const urlStrings = new Set(
    buildSourceUrlFetchCandidates(sourceUrl).map((u) => u.trim().toLowerCase())
  );
  const sourcesDir = path.resolve(process.cwd(), 'data/sources');
  if (!fs.existsSync(sourcesDir)) return null;

  for (const file of fs.readdirSync(sourcesDir)) {
    if (!file.endsWith('.meta.json')) continue;
    const metaPath = path.join(sourcesDir, file);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        url?: string;
        canonical_url?: string;
      };
      const metaIdentity = canonicalizeAndHashSourceUrl(meta.canonical_url || meta.url || '');
      if (metaIdentity?.canonicalUrlHash === targetIdentity.canonicalUrlHash) {
        const txtPath = metaPath.replace(/\.meta\.json$/, '.txt');
        return fs.existsSync(txtPath) ? txtPath : null;
      }
      const raw = typeof meta.url === 'string' ? meta.url.trim().toLowerCase() : '';
      if (raw && urlStrings.has(raw)) {
        const txtPath = metaPath.replace(/\.meta\.json$/, '.txt');
        return fs.existsSync(txtPath) ? txtPath : null;
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return null;
}

async function verifySurrealSync(params: {
  canonicalUrlHash?: string;
  sourceUrl?: string;
  requireClaims?: boolean;
}): Promise<{ ok: boolean; summary: string }> {
  const rows = await surrealQuery<Array<{ id?: string; title?: string; claim_count?: number | null }>>(
    `
      SELECT id, title, claim_count
      FROM source
      WHERE ($canonicalUrlHash != NONE AND canonical_url_hash = $canonicalUrlHash)
         OR ($sourceUrl != NONE AND (url = $sourceUrl OR canonical_url = $sourceUrl))
      ORDER BY ingested_at DESC
      LIMIT 1
    `,
    {
      canonicalUrlHash: params.canonicalUrlHash ?? null,
      sourceUrl: params.sourceUrl ?? null
    }
  );

  const source = Array.isArray(rows) ? rows[0] : null;
  if (!source?.id) {
    return { ok: false, summary: 'No matching source record found in SurrealDB.' };
  }

  const claimRows = await surrealQuery<Array<{ count?: number }>>(
    'SELECT count() AS count FROM claim WHERE source = type::thing($sourceId) GROUP ALL',
    { sourceId: String(source.id).replace(/^source:/, '') }
  );
  const claimCount = claimRows?.[0]?.count ?? 0;

  if (params.requireClaims && claimCount <= 0) {
    return {
      ok: false,
      summary: `Source ${source.id} exists but has no claims yet.`
    };
  }

  return {
    ok: true,
    summary: `Source ${source.id} synced with ${claimCount} claims.`
  };
}

async function updateOperationDoc(
  id: string,
  data: Partial<AdminOperationDoc>
): Promise<void> {
  await operationsCollection().doc(id).set(
    {
      ...data,
      updated_at: Timestamp.now()
    },
    { merge: true }
  );
}

async function setOperationFailed(
  id: string,
  status: Extract<AdminOperationStatus, 'failed' | 'validation_failed' | 'sync_failed' | 'cancelled'>,
  message: string,
  logText: string
): Promise<void> {
  await updateOperationDoc(id, {
    status,
    last_error: message,
    result_summary: message,
    log_text: logText,
    completed_at: Timestamp.now(),
    cancelled_at: status === 'cancelled' ? Timestamp.now() : null
  });
}

async function runCommandWithLogs(params: {
  id: string;
  command: string;
  args: string[];
  logText: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ logText: string; status: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...params.env },
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams & EventEmitter;
    runningProcesses.set(params.id, child);

    let stdout = '';
    let stderr = '';
    let logText = params.logText;

    const append = async (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf-8');
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      logText = `${logText}${text}`.slice(-60000);
      await updateOperationDoc(params.id, { log_text: logText });
    };

    child.stdout.on('data', (chunk: Buffer) => {
      void append(chunk, 'stdout');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      void append(chunk, 'stderr');
    });

    child.on('error', async (error: Error) => {
      runningProcesses.delete(params.id);
      logText = `${logText}\n[PROCESS ERROR] ${error.message}\n`.slice(-60000);
      await updateOperationDoc(params.id, { log_text: logText });
      reject(error);
    });

    child.on('close', async (code: number | null) => {
      runningProcesses.delete(params.id);
      await updateOperationDoc(params.id, { log_text: logText });
      resolve({
        logText,
        status: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function executeValidateOperation(
  id: string,
  payload: z.infer<typeof ValidatePayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  let nextLog = `${logText}[VALIDATE] Running Restormel validate\n`;
  await updateOperationDoc(id, { log_text: nextLog });

  if (!payload.dry_run) {
    const result = await runCommandWithLogs({
      id,
      command: 'npx',
      args: ['@restormel/validate'],
      logText: nextLog
    });
    nextLog = result.logText;
    if (result.status !== 0) {
      return {
        logText: nextLog,
        status: 'validation_failed',
        summary: 'Restormel validate failed.',
        validationStatus: 'failed',
        syncStatus: 'pending'
      };
    }
  }

  if (payload.scope === 'restormel') {
    return {
      logText: `${nextLog}[VALIDATE] Restormel validation passed.\n`,
      status: 'succeeded',
      summary: 'Restormel validation passed.',
      validationStatus: 'passed',
      syncStatus: 'skipped'
    };
  }

  const syncResult = await verifySurrealSync({
    canonicalUrlHash: payload.canonical_url_hash,
    sourceUrl: payload.source_url,
    requireClaims: false
  });
  nextLog = `${nextLog}[SYNC] ${syncResult.summary}\n`;

  return {
    logText: nextLog,
    status: syncResult.ok ? 'succeeded' : 'sync_failed',
    summary: syncResult.ok ? 'Validation and Surreal verification passed.' : syncResult.summary,
    validationStatus: 'passed',
    syncStatus: syncResult.ok ? 'passed' : 'failed'
  };
}

async function executeDiagnoseOperation(
  id: string,
  payload: z.infer<typeof DiagnoseDoctorPayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  let nextLog = `${logText}[DIAGNOSE] Running Restormel doctor / smoke checks\n`;
  await updateOperationDoc(id, { log_text: nextLog });

  const env: NodeJS.ProcessEnv = {};
  if (payload.blocked_model_id) env.RESTORMEL_SMOKE_BLOCKED_MODEL_ID = payload.blocked_model_id;
  if (payload.blocked_provider_type) env.RESTORMEL_SMOKE_BLOCKED_PROVIDER_TYPE = payload.blocked_provider_type;

  if (!payload.dry_run) {
    const result = await runCommandWithLogs({
      id,
      command: 'bash',
      args: ['scripts/smoke-test-restormel.sh'],
      logText: nextLog,
      env
    });
    nextLog = result.logText;
    if (result.status !== 0) {
      return {
        logText: nextLog,
        status: 'failed',
        summary: 'Restormel diagnostics failed.',
        validationStatus: 'failed',
        syncStatus: 'skipped'
      };
    }
  }

  if (payload.scope === 'restormel') {
    return {
      logText: `${nextLog}[DIAGNOSE] Restormel diagnostics passed.\n`,
      status: 'succeeded',
      summary: 'Restormel diagnostics passed.',
      validationStatus: 'passed',
      syncStatus: 'skipped'
    };
  }

  const surrealHealth = await surrealQuery<Array<{ health?: number }>>('SELECT 1 AS health');
  nextLog = `${nextLog}[DIAGNOSE] Surreal responded with ${surrealHealth?.[0]?.health ?? 'unknown'}.\n`;
  return {
    logText: nextLog,
    status: 'succeeded',
    summary: 'Restormel and Surreal diagnostics passed.',
    validationStatus: 'passed',
    syncStatus: 'passed'
  };
}

async function executeIngestImportOperation(
  id: string,
  payload: z.infer<typeof IngestImportPayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  const env: NodeJS.ProcessEnv = {};
  let nextLog = logText;
  let sourceFile = payload.source_file ? normalizeTextFilePath(payload.source_file) : null;

  if (payload.source_url) {
    nextLog = `${nextLog}[INGEST] Fetching ${payload.source_url}\n`;
    await updateOperationDoc(id, { log_text: nextLog });
    if (!payload.dry_run) {
      const fetchSpawn = buildLocalTsxSpawnArgs([
        'scripts/fetch-source.ts',
        payload.source_url,
        payload.source_type!
      ]);
      const fetchResult = await runCommandWithLogs({
        id,
        command: fetchSpawn.command,
        args: fetchSpawn.args,
        logText: nextLog
      });
      nextLog = fetchResult.logText;
      if (fetchResult.status !== 0) {
        return {
          logText: nextLog,
          status: 'failed',
          summary: 'Source fetch failed.',
          validationStatus: 'failed',
          syncStatus: 'pending'
        };
      }
      sourceFile = findFetchedSourceFile(payload.source_url);
    }
  }

  if (!sourceFile) {
    const hintLines: string[] = [];
    if (payload.dry_run) {
      hintLines.push(
        'Dry run is on — fetch was skipped, so no local .txt was written. Turn off dry run, or provide source_file with an absolute path to an existing .txt.'
      );
    } else if (payload.source_url) {
      hintLines.push(
        'Expected data/sources/<slug>.txt plus a matching .meta.json after fetch (matched by canonical URL hash).'
      );
      hintLines.push(
        'If fetch exited 0 but nothing was found, the runtime may be missing scripts/ or src/ (hosted images must COPY them for tsx), or the URL in the payload differs from the canonical URL stored in meta.'
      );
    } else {
      hintLines.push('Provide source_file pointing to a readable .txt on the server, or source_url + source_type for fetch.');
    }
    const hintBlock = hintLines.map((line) => `[INGEST] ${line}\n`).join('');
    return {
      logText: `${nextLog}[INGEST] Unable to resolve source file for ingestion.\n${hintBlock}`,
      status: 'failed',
      summary: `Unable to resolve source file for ingestion.${payload.dry_run ? ' Dry run skips fetch.' : ''}`,
      validationStatus: 'failed',
      syncStatus: 'pending'
    };
  }

  nextLog = `${nextLog}[INGEST] Running ingest for ${sourceFile}\n`;
  await updateOperationDoc(id, { log_text: nextLog });

  if (!payload.dry_run) {
    const ingestTail = ['scripts/ingest.ts', sourceFile];
    if (payload.validate) ingestTail.push('--validate');
    if (payload.ingest_provider) ingestTail.push('--ingest-provider', payload.ingest_provider);
    if (payload.domain) ingestTail.push('--domain', payload.domain);

    const ingestSpawn = buildLocalTsxSpawnArgs(ingestTail);
    const ingestResult = await runCommandWithLogs({
      id,
      command: ingestSpawn.command,
      args: ingestSpawn.args,
      logText: nextLog,
      env
    });
    nextLog = ingestResult.logText;
    if (ingestResult.status !== 0) {
      return {
        logText: nextLog,
        status: 'failed',
        summary: 'Ingestion command failed.',
        validationStatus: 'failed',
        syncStatus: 'pending'
      };
    }
  }

  const sourceUrl = payload.source_url;
  const canonicalUrlHash = sourceUrl ? canonicalizeAndHashSourceUrl(sourceUrl)?.canonicalUrlHash : undefined;
  const syncResult = await verifySurrealSync({
    canonicalUrlHash,
    sourceUrl,
    requireClaims: true
  });
  nextLog = `${nextLog}[SYNC] ${syncResult.summary}\n`;

  return {
    logText: nextLog,
    status: syncResult.ok ? 'succeeded' : 'sync_failed',
    summary: syncResult.ok ? 'Ingestion completed and synced to Surreal.' : syncResult.summary,
    validationStatus: payload.validate ? 'passed' : 'skipped',
    syncStatus: syncResult.ok ? 'passed' : 'failed'
  };
}

async function executeReplayOperation(
  id: string,
  payload: z.infer<typeof ReplayReingestPayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  const replayTail = ['scripts/replay-ingest.ts', '--canonical-url-hash', payload.canonical_url_hash];
  if (payload.force_stage) replayTail.push('--force-stage', payload.force_stage);
  if (payload.ingest_provider) replayTail.push('--ingest-provider', payload.ingest_provider);
  if (payload.domain) replayTail.push('--domain', payload.domain);
  if (payload.validate) replayTail.push('--validate');
  if (payload.dry_run) replayTail.push('--dry-run');

  let nextLog = `${logText}[REPLAY] Replaying ${payload.canonical_url_hash}\n`;
  await updateOperationDoc(id, { log_text: nextLog });

  if (!payload.dry_run) {
    const replaySpawn = buildLocalTsxSpawnArgs(replayTail);
    const replayResult = await runCommandWithLogs({
      id,
      command: replaySpawn.command,
      args: replaySpawn.args,
      logText: nextLog
    });
    nextLog = replayResult.logText;
    if (replayResult.status !== 0) {
      return {
        logText: nextLog,
        status: 'failed',
        summary: 'Replay command failed.',
        validationStatus: 'failed',
        syncStatus: 'pending'
      };
    }
  }

  const syncResult = await verifySurrealSync({
    canonicalUrlHash: payload.canonical_url_hash,
    requireClaims: true
  });
  nextLog = `${nextLog}[SYNC] ${syncResult.summary}\n`;

  return {
    logText: nextLog,
    status: syncResult.ok ? 'succeeded' : 'sync_failed',
    summary: syncResult.ok ? 'Replay completed and synced to Surreal.' : syncResult.summary,
    validationStatus: payload.validate ? 'passed' : 'skipped',
    syncStatus: syncResult.ok ? 'passed' : 'failed'
  };
}

async function executeRepairOperation(
  id: string,
  payload: z.infer<typeof RepairFinalizePayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  const repairTail = [
    'scripts/run-ingestion-safe.ts',
    '--source-file',
    normalizeTextFilePath(payload.source_file),
    '--mode',
    payload.mode
  ];
  if (payload.force_migrate) repairTail.push('--force-migrate');
  if (payload.allow_local_reingest) repairTail.push('--allow-local-reingest');
  if (payload.confirm_direct_prod) repairTail.push('--confirm-direct-prod');
  if (payload.skip_backup) repairTail.push('--skip-backup');
  if (payload.dry_run) repairTail.push('--dry-run');

  let nextLog = `${logText}[REPAIR] Running safe ingestion repair for ${payload.source_file}\n`;
  await updateOperationDoc(id, { log_text: nextLog });

  if (!payload.dry_run) {
    const repairSpawn = buildLocalTsxSpawnArgs(repairTail);
    const result = await runCommandWithLogs({
      id,
      command: repairSpawn.command,
      args: repairSpawn.args,
      logText: nextLog
    });
    nextLog = result.logText;
    if (result.status !== 0) {
      return {
        logText: nextLog,
        status: 'failed',
        summary: 'Repair / finalize command failed.',
        validationStatus: 'failed',
        syncStatus: 'pending'
      };
    }
  }

  return {
    logText: `${nextLog}[REPAIR] Safe ingestion repair completed.\n`,
    status: 'succeeded',
    summary: 'Repair / finalize completed.',
    validationStatus: 'passed',
    syncStatus: 'passed'
  };
}

async function executeSyncOperation(
  payload: z.infer<typeof SyncToSurrealPayloadSchema>,
  logText: string
): Promise<{ logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] }> {
  const syncResult = await verifySurrealSync({
    canonicalUrlHash: payload.canonical_url_hash,
    sourceUrl: payload.source_url,
    requireClaims: payload.require_claims ?? false
  });
  const nextLog = `${logText}[SYNC] ${syncResult.summary}\n`;
  return {
    logText: nextLog,
    status: syncResult.ok ? 'succeeded' : 'sync_failed',
    summary: syncResult.summary,
    validationStatus: 'skipped',
    syncStatus: syncResult.ok ? 'passed' : 'failed'
  };
}

async function executeOperation(id: string, record: AdminOperationRecord): Promise<void> {
  let logText = record.log_text || '';
  const payload = record.payload;

  const liveDoc = await operationsCollection().doc(id).get();
  const liveRecord = serializeOperation(id, liveDoc.data() as Partial<AdminOperationDoc> | undefined);
  if (liveRecord.cancel_requested) {
    await setOperationFailed(id, 'cancelled', 'Operation cancelled before execution started.', `${logText}[CANCEL] Operation cancelled before execution.\n`);
    return;
  }

  await updateOperationDoc(id, {
    status: 'running',
    started_at: liveDoc.data()?.started_at ?? Timestamp.now(),
    last_error: null
  });

  try {
    let result: { logText: string; status: AdminOperationStatus; summary: string; validationStatus: AdminOperationRecord['validation_status']; syncStatus: AdminOperationRecord['sync_status'] };
    switch (record.kind) {
      case 'validate':
        result = await executeValidateOperation(id, ValidatePayloadSchema.parse(payload), logText);
        break;
      case 'diagnose_doctor':
        result = await executeDiagnoseOperation(id, DiagnoseDoctorPayloadSchema.parse(payload), logText);
        break;
      case 'ingest_import':
        result = await executeIngestImportOperation(id, IngestImportPayloadSchema.parse(payload), logText);
        break;
      case 'replay_reingest':
        result = await executeReplayOperation(id, ReplayReingestPayloadSchema.parse(payload), logText);
        break;
      case 'repair_finalize':
        result = await executeRepairOperation(id, RepairFinalizePayloadSchema.parse(payload), logText);
        break;
      case 'sync_to_surreal':
        result = await executeSyncOperation(SyncToSurrealPayloadSchema.parse(payload), logText);
        break;
      default:
        throw new Error(`Unsupported operation kind: ${record.kind satisfies never}`);
    }

    await updateOperationDoc(id, {
      status: result.status,
      result_summary: result.summary,
      validation_status: result.validationStatus,
      sync_status: result.syncStatus,
      log_text: result.logText,
      completed_at: Timestamp.now()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logText = `${logText}[ERROR] ${message}\n`;
    await setOperationFailed(id, 'failed', message, logText);
  }
}

export function queueAdminOperationProcessing(id: string): void {
  if (processingPromises.has(id)) return;
  const promise = (async () => {
    try {
      const snapshot = await operationsCollection().doc(id).get();
      const record = serializeOperation(id, snapshot.data() as Partial<AdminOperationDoc> | undefined);
      if (record.status !== 'queued') {
        return;
      }
      await executeOperation(id, record);
    } finally {
      processingPromises.delete(id);
    }
  })();
  processingPromises.set(id, promise);
  void promise;
}

async function resumeStaleOperation(id: string, record: AdminOperationRecord): Promise<void> {
  if (processingPromises.has(id)) return;
  const startedAt = record.started_at ? new Date(record.started_at).getTime() : 0;
  if (record.status === 'queued') {
    queueAdminOperationProcessing(id);
    return;
  }
  if (record.status === 'running' && Date.now() - startedAt > STALE_RUNNING_THRESHOLD_MS) {
    await updateOperationDoc(id, {
      status: 'queued',
      log_text: `${record.log_text}\n[RECOVER] Re-queueing stale running job.\n`
    });
    queueAdminOperationProcessing(id);
  }
}

export async function listAdminOperations(limit = OPERATION_LIMIT_DEFAULT): Promise<AdminOperationRecord[]> {
  const cappedLimit = Math.max(1, Math.min(OPERATION_LIMIT_MAX, limit));
  const snapshot = await operationsCollection()
    .orderBy('created_at', 'desc')
    .limit(cappedLimit)
    .get();
  const operations = snapshot.docs.map((doc) =>
    serializeOperation(doc.id, doc.data() as Partial<AdminOperationDoc>)
  );
  await Promise.all(operations.slice(0, 5).map((operation) => resumeStaleOperation(operation.id, operation)));
  return operations;
}

export async function getAdminOperation(id: string): Promise<AdminOperationRecord | null> {
  const snapshot = await operationsCollection().doc(id).get();
  if (!snapshot.exists) return null;
  const record = serializeOperation(id, snapshot.data() as Partial<AdminOperationDoc>);
  await resumeStaleOperation(id, record);
  const refreshed = await operationsCollection().doc(id).get();
  return serializeOperation(id, refreshed.data() as Partial<AdminOperationDoc> | undefined);
}

export async function createAdminOperation(
  actor: AdminActor,
  request: unknown
): Promise<AdminOperationRecord> {
  const parsed = AdminOperationRequestSchema.parse(request);
  const now = Timestamp.now();
  const docRef = operationsCollection().doc();
  const doc: AdminOperationDoc = {
    kind: parsed.kind,
    status: 'queued',
    payload: parsed.payload,
    requested_by_uid: actor.uid,
    requested_by_email: actor.email ?? null,
    attempts: 1,
    requested_action: resolveRequestedAction(parsed.kind),
    executor: defaultExecutor(parsed.kind),
    restormel_tool: defaultRestormelTool(parsed.kind),
    hosted_run_id: null,
    validation_status: 'pending',
    sync_status: parsed.kind === 'diagnose_doctor' ? 'skipped' : 'pending',
    result_summary: null,
    last_error: null,
    log_text: `[QUEUE] ${resolveRequestedAction(parsed.kind)} queued by ${actor.uid}\n`,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_requested: false
  };

  await docRef.set(doc);
  const record = serializeOperation(docRef.id, doc);
  queueAdminOperationProcessing(docRef.id);
  return record;
}

export async function cancelAdminOperation(id: string, actor: AdminActor): Promise<AdminOperationRecord | null> {
  const snapshot = await operationsCollection().doc(id).get();
  if (!snapshot.exists) return null;
  const record = serializeOperation(id, snapshot.data() as Partial<AdminOperationDoc>);
  const nextLog = `${record.log_text}[CANCEL] Cancellation requested by ${actor.uid}\n`;

  const proc = runningProcesses.get(id);
  if (proc) {
    proc.kill('SIGTERM');
  }

  await updateOperationDoc(id, {
    cancel_requested: true,
    status: record.status === 'queued' ? 'cancelled' : record.status,
    cancelled_at: record.status === 'queued' ? Timestamp.now() : null,
    completed_at: record.status === 'queued' ? Timestamp.now() : null,
    result_summary: record.status === 'queued' ? 'Operation cancelled before execution.' : record.result_summary,
    log_text: nextLog
  });

  return await getAdminOperation(id);
}

export async function retryAdminOperation(id: string, actor: AdminActor): Promise<AdminOperationRecord | null> {
  const snapshot = await operationsCollection().doc(id).get();
  if (!snapshot.exists) return null;
  const record = serializeOperation(id, snapshot.data() as Partial<AdminOperationDoc>);

  await updateOperationDoc(id, {
    status: 'queued',
    cancel_requested: false,
    cancelled_at: null,
    completed_at: null,
    started_at: null,
    last_error: null,
    result_summary: `Retry requested by ${actor.uid}.`,
    attempts: record.attempts + 1,
    log_text: `${record.log_text}[RETRY] Retry requested by ${actor.uid}\n`
  });

  queueAdminOperationProcessing(id);
  return await getAdminOperation(id);
}
