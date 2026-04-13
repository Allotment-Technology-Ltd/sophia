/**
 * Durable multi-URL ingestion jobs (Neon). Ticks launch child runs via ingestRunManager.
 */

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDrizzleDb } from './db/neon';
import {
	ingestRunIssues,
	ingestRuns,
	ingestStagingValidation,
	ingestionJobEvents,
	ingestionJobItems,
	ingestionJobs
} from './db/schema';
import { neonAbandonIngestRunForJobCancel, neonLoadIngestRun } from './db/ingestRunRepository';
import { isNeonIngestPersistenceEnabled } from './neon/datastore';
import {
	classifyIngestJobErrorMessage,
	computeLaunchThrottleBackoffMs,
	isLaunchThrottleError,
	shouldAutoRequeueIngestJobItem
} from './ingestion/ingestionJobErrorClassify';
import { runIngestionJobPreflightOrThrow } from './ingestion/ingestionJobPreflight';
import {
	inferSourceTypeFromUrl,
	ingestRunManager,
	type IngestRunPayload,
	type IngestRunState
} from './ingestRuns';
import { resolvePipelineVersion } from './ingestionPipelineMetadata';
import {
	CANONICAL_VOYAGE_EMBEDDING_FINGERPRINT,
	CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL
} from '$lib/ingestionCanonicalPipeline';
import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';
import {
	computeIngestionJobTickSpawnCap,
	ingestRunStillOccupiesLlmConcurrencySlot
} from './ingestion/ingestCapacityAtStore';
import { sweepStalledIngestRuns, sweepWorkerOrphanIngestRuns } from './ingestion/ingestWatchdog';
import { sanitizeIngestionJobWorkerDefaults } from './ingestionJobWorkerDefaults';

const ADV_LOCK_JOB_EVENTS = 5_849_273;

/**
 * Serialize `tickIngestionJob` per `jobId`. Overlapping ticks (e.g. `void tickIngestionJob` on job create +
 * ingestion poller) previously raced: both could pass `ADMIN_INGEST_MAX_CONCURRENT` before either row
 * flipped to `running`, launching one extra child and blocking the next URL with a misleading “3 max” error.
 */
const tickIngestionJobTailByJobId = new Map<string, Promise<void>>();

function sleepMs(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Random 0..max ms delay between spawning child runs (spread load). Env INGEST_JOB_LAUNCH_JITTER_MS. */
function ingestJobLaunchJitterMs(): number {
	const r = parseInt(process.env.INGEST_JOB_LAUNCH_JITTER_MS ?? '0', 10);
	return Number.isFinite(r) && r > 0 ? Math.min(30_000, r) : 0;
}

/** Max total starts per job item (initial + retries). Env `INGEST_JOB_ITEM_MAX_ATTEMPTS`, default 2. */
export function getIngestionJobItemMaxAttempts(): number {
	const r = parseInt(process.env.INGEST_JOB_ITEM_MAX_ATTEMPTS ?? '2', 10);
	return Number.isFinite(r) && r >= 1 ? Math.min(20, r) : 2;
}

function canAutoRequeueAfterFailure(attemptsAfterFailure: number): boolean {
	return attemptsAfterFailure < getIngestionJobItemMaxAttempts();
}

/**
 * When `1`, auto-requeue after retryable failures clears `child_run_id` so the next tick always starts a
 * fresh ingest run (legacy behaviour). Default **off**: the same Neon run id is kept so the job tick can
 * `resumeFromFailure` and continue from Surreal / Neon checkpoints instead of redoing completed stages.
 */
export function ingestionJobAutoRequeueClearsChildRunId(): boolean {
	return process.env.INGEST_JOB_AUTO_REQUEUE_CLEAR_CHILD_RUN_ID === '1';
}

/** Convert eligible `error` rows to `pending` (back of queue via newer `updatedAt`). */
async function applyAutoRequeueForJobErrors(jobId: string): Promise<void> {
	const db = getDrizzleDb();
	const maxA = getIngestionJobItemMaxAttempts();
	const clearRunId = ingestionJobAutoRequeueClearsChildRunId();
	const rows = await db
		.select()
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), eq(ingestionJobItems.status, 'error')));
	for (const it of rows) {
		if (!canAutoRequeueAfterFailure(it.attempts)) continue;
		if (!shouldAutoRequeueIngestJobItem(it.lastError)) continue;
		const preservedCheckpoint =
			!clearRunId && typeof it.childRunId === 'string' && it.childRunId.trim().length > 0;
		await db
			.update(ingestionJobItems)
			.set({
				status: 'pending',
				...(clearRunId ? { childRunId: null } : {}),
				blockedUntil: null,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await appendIngestionJobEvent(jobId, 'item_requeued_auto', {
			itemId: it.id,
			url: it.url,
			attempts: it.attempts,
			maxAttempts: maxA,
			reason: 'retry_after_failure',
			preservedChildRunIdForResume: preservedCheckpoint
		});
	}
}

function exhaustionFailureClassFromKind(kind: ReturnType<typeof classifyIngestJobErrorMessage>): string {
	if (kind === 'permanent') return 'permanent';
	if (kind === 'retryable') return 'retryable_exhausted';
	return 'unknown_exhausted';
}

/** Mark `error` items that hit max attempts as DLQ (idempotent). */
async function syncDlqForExhaustedJobItems(jobId: string): Promise<void> {
	const db = getDrizzleDb();
	const maxA = getIngestionJobItemMaxAttempts();
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(
			and(
				eq(ingestionJobItems.jobId, jobId),
				eq(ingestionJobItems.status, 'error'),
				gte(ingestionJobItems.attempts, maxA),
				isNull(ingestionJobItems.dlqEnqueuedAt)
			)
		);
	for (const it of items) {
		const kind = classifyIngestJobErrorMessage(it.lastError);
		const failureClass = exhaustionFailureClassFromKind(kind);
		await db
			.update(ingestionJobItems)
			.set({
				dlqEnqueuedAt: new Date(),
				lastFailureKind: kind,
				failureClass,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await appendIngestionJobEvent(jobId, 'item_dlq', {
			itemId: it.id,
			url: it.url,
			lastError: it.lastError,
			kind,
			failureClass,
			maxAttempts: maxA
		});
	}
}

/** Catch-up for admin DLQ list: any exhausted error rows not yet stamped. */
export async function syncDlqForAllExhaustedItems(): Promise<number> {
	if (!isNeonIngestPersistenceEnabled()) return 0;
	const db = getDrizzleDb();
	const maxA = getIngestionJobItemMaxAttempts();
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(
			and(
				eq(ingestionJobItems.status, 'error'),
				gte(ingestionJobItems.attempts, maxA),
				isNull(ingestionJobItems.dlqEnqueuedAt)
			)
		);
	for (const it of items) {
		const kind = classifyIngestJobErrorMessage(it.lastError);
		const failureClass = exhaustionFailureClassFromKind(kind);
		await db
			.update(ingestionJobItems)
			.set({
				dlqEnqueuedAt: new Date(),
				lastFailureKind: kind,
				failureClass,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await appendIngestionJobEvent(it.jobId, 'item_dlq', {
			itemId: it.id,
			url: it.url,
			lastError: it.lastError,
			kind,
			failureClass,
			maxAttempts: maxA
		});
	}
	return items.length;
}

export type IngestionJobDlqRow = {
	itemId: string;
	jobId: string;
	url: string;
	lastError: string | null;
	failureClass: string | null;
	lastFailureKind: string | null;
	dlqEnqueuedAt: string | null;
	attempts: number;
	dlqReplayCount: number;
	jobNotes: string | null;
	jobStatus: string;
};

export async function listIngestionJobDlqItems(limit: number): Promise<IngestionJobDlqRow[]> {
	if (!isNeonIngestPersistenceEnabled()) return [];
	const db = getDrizzleDb();
	const cap = Math.max(1, Math.min(200, limit));
	const rows = await db
		.select({
			item: ingestionJobItems,
			jobStatus: ingestionJobs.status,
			jobNotes: ingestionJobs.notes
		})
		.from(ingestionJobItems)
		.innerJoin(ingestionJobs, eq(ingestionJobItems.jobId, ingestionJobs.id))
		.where(
			and(
				eq(ingestionJobItems.status, 'error'),
				isNotNull(ingestionJobItems.dlqEnqueuedAt)
			)
		)
		.orderBy(desc(ingestionJobItems.dlqEnqueuedAt))
		.limit(cap);
	return rows.map((r) => ({
		itemId: r.item.id,
		jobId: r.item.jobId,
		url: r.item.url,
		lastError: r.item.lastError ?? null,
		failureClass: r.item.failureClass ?? null,
		lastFailureKind: r.item.lastFailureKind ?? null,
		dlqEnqueuedAt: r.item.dlqEnqueuedAt?.toISOString() ?? null,
		attempts: r.item.attempts,
		dlqReplayCount: r.item.dlqReplayCount ?? 0,
		jobNotes: r.jobNotes ?? null,
		jobStatus: r.jobStatus
	}));
}

export async function replayDlqJobItems(itemIds: string[]): Promise<
	{ ok: true; replayed: number; jobIds: string[] } | { ok: false; error: string }
> {
	if (!isNeonIngestPersistenceEnabled()) return { ok: false, error: 'Neon ingest persistence is not enabled.' };
	const ids = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))];
	if (ids.length === 0) return { ok: false, error: 'No item ids provided.' };
	const db = getDrizzleDb();
	let replayed = 0;
	const jobIds = new Set<string>();
	for (const id of ids) {
		const [it] = await db.select().from(ingestionJobItems).where(eq(ingestionJobItems.id, id)).limit(1);
		// DLQ replay: only rows that were stamped into the dead-letter queue (max attempts exhausted).
		if (!it || it.status !== 'error' || it.dlqEnqueuedAt == null) continue;
		await db
			.update(ingestionJobItems)
			.set({
				status: 'pending',
				childRunId: null,
				lastError: null,
				blockedUntil: null,
				launchThrottleCount: 0,
				dlqEnqueuedAt: null,
				lastFailureKind: null,
				failureClass: null,
				dlqReplayCount: (it.dlqReplayCount ?? 0) + 1,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, id));
		await db
			.update(ingestionJobs)
			.set({ status: 'running', completedAt: null, updatedAt: new Date() })
			.where(eq(ingestionJobs.id, it.jobId));
		await appendIngestionJobEvent(it.jobId, 'item_replay_from_dlq', {
			itemId: id,
			url: it.url,
			replayKind: 'manual'
		});
		jobIds.add(it.jobId);
		replayed++;
	}
	return { ok: true, replayed, jobIds: [...jobIds] };
}

function getDlqAutoReplayDelayMs(): number {
	const r = parseInt(process.env.INGEST_DLQ_AUTO_REPLAY_DELAY_MS ?? '0', 10);
	return Number.isFinite(r) && r >= 60_000 ? Math.min(r, 86_400_000) : 0;
}

/** Move `retryable_exhausted` DLQ rows back to `pending` after cooldown (optional autonomy). */
export async function applyDlqAutoReplayIfEnabled(): Promise<number> {
	const delayMs = getDlqAutoReplayDelayMs();
	if (!isNeonIngestPersistenceEnabled() || delayMs <= 0) return 0;
	const db = getDrizzleDb();
	const cutoff = new Date(Date.now() - delayMs);
	const rows = await db
		.select()
		.from(ingestionJobItems)
		.where(
			and(
				eq(ingestionJobItems.status, 'error'),
				eq(ingestionJobItems.failureClass, 'retryable_exhausted'),
				isNotNull(ingestionJobItems.dlqEnqueuedAt),
				lte(ingestionJobItems.dlqEnqueuedAt, cutoff)
			)
		)
		.limit(50);
	let n = 0;
	for (const it of rows) {
		await db
			.update(ingestionJobItems)
			.set({
				status: 'pending',
				childRunId: null,
				lastError: null,
				blockedUntil: null,
				launchThrottleCount: 0,
				dlqEnqueuedAt: null,
				lastFailureKind: null,
				failureClass: null,
				dlqReplayCount: (it.dlqReplayCount ?? 0) + 1,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await db
			.update(ingestionJobs)
			.set({ status: 'running', completedAt: null, updatedAt: new Date() })
			.where(eq(ingestionJobs.id, it.jobId));
		await appendIngestionJobEvent(it.jobId, 'item_replay_from_dlq_auto', {
			itemId: it.id,
			url: it.url,
			delayMs
		});
		n++;
	}
	return n;
}

export type IngestionJobItemStatus =
	| 'pending'
	| 'running'
	| 'done'
	| 'error'
	| 'skipped'
	| 'cancelled';

function buildJobId(): string {
	return `ingest_job_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function buildItemId(): string {
	return `ij_item_${randomBytes(6).toString('hex')}`;
}

export async function appendIngestionJobEvent(
	jobId: string,
	eventType: string,
	payload: Record<string, unknown> | null
): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_JOB_EVENTS}, hashtext(${jobId}))`);
		const [row] = await tx
			.select({ m: sql<number>`COALESCE(MAX(${ingestionJobEvents.seq}), 0)`.mapWith(Number) })
			.from(ingestionJobEvents)
			.where(eq(ingestionJobEvents.jobId, jobId));
		const nextSeq = (row?.m ?? 0) + 1;
		await tx.insert(ingestionJobEvents).values({
			jobId,
			seq: nextSeq,
			eventType,
			payload
		});
	});
}

export type CreateIngestionJobArgs = {
	urls: string[];
	concurrency?: number;
	notes?: string | null;
	actorUid: string;
	actorEmail: string | null;
	validate?: boolean;
	/** Merged into each child run `payload.batch_overrides` when items launch (bounded subset). */
	workerDefaults?: unknown;
	/**
	 * When true, append URLs as new items on the most recently updated `running` job instead of creating
	 * a second job (avoids doubling ADMIN_INGEST_MAX_CONCURRENT pressure from parallel workers).
	 */
	mergeIntoLatestRunningJob?: boolean;
};

async function findLatestRunningIngestionJobId(): Promise<string | null> {
	const db = getDrizzleDb();
	const [row] = await db
		.select({ id: ingestionJobs.id })
		.from(ingestionJobs)
		.where(eq(ingestionJobs.status, 'running'))
		.orderBy(desc(ingestionJobs.updatedAt))
		.limit(1);
	return row?.id ?? null;
}

/**
 * Append URLs as pending items on an existing job (dedupe by exact URL string already on the job).
 */
export async function appendUrlsToIngestionJob(
	jobId: string,
	urls: string[]
): Promise<{ added: number; skippedDuplicate: number }> {
	const db = getDrizzleDb();
	const job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId)
	});
	if (!job) throw new Error('Job not found.');
	if (job.status !== 'running') {
		throw new Error(`Job is not running (status=${job.status}); cannot append URLs.`);
	}

	const existingRows = await db
		.select({ url: ingestionJobItems.url })
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));
	const seen = new Set(existingRows.map((r) => r.url.trim()));

	let added = 0;
	let skippedDuplicate = 0;
	for (const raw of urls) {
		const u = raw.trim();
		if (!u) continue;
		if (seen.has(u)) {
			skippedDuplicate += 1;
			continue;
		}
		seen.add(u);
		await db.insert(ingestionJobItems).values({
			id: buildItemId(),
			jobId,
			url: u,
			sourceType: inferSourceTypeFromUrl(u),
			status: 'pending',
			attempts: 0
		});
		added += 1;
	}

	if (added > 0) {
		await appendIngestionJobEvent(jobId, 'urls_appended', {
			added,
			skippedDuplicate,
			merge: true
		});
		await reconcileIngestionJobView(jobId);
		void tickIngestionJob(jobId);
	}

	return { added, skippedDuplicate };
}

export async function createIngestionJob(
	args: CreateIngestionJobArgs
): Promise<{ id: string; merged?: boolean } | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const db = getDrizzleDb();
	const urls = [...new Set(args.urls.map((u) => u.trim()).filter(Boolean))];
	if (urls.length === 0) throw new Error('At least one URL is required');

	if ((process.env.INGEST_JOB_PREFLIGHT ?? '').trim() === '1') {
		await runIngestionJobPreflightOrThrow();
	}

	if (args.mergeIntoLatestRunningJob === true) {
		const target = await findLatestRunningIngestionJobId();
		if (target) {
			await appendUrlsToIngestionJob(target, urls);
			return { id: target, merged: true };
		}
	}

	const id = buildJobId();
	const concurrency = Math.max(
		1,
		Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, args.concurrency ?? 2)
	);
	const pipelineVersion = resolvePipelineVersion();
	const embeddingFingerprint = CANONICAL_VOYAGE_EMBEDDING_FINGERPRINT;
	const workerDefaults = sanitizeIngestionJobWorkerDefaults(args.workerDefaults) ?? {};

	await db.insert(ingestionJobs).values({
		id,
		status: 'running',
		concurrency,
		actorUid: args.actorUid,
		actorEmail: args.actorEmail,
		notes: args.notes ?? null,
		validateLlm: args.validate === true,
		workerDefaults: workerDefaults as Record<string, unknown>,
		summary: {
			total: urls.length,
			pending: urls.length,
			running: 0,
			done: 0,
			error: 0,
			cancelled: 0,
			skipped: 0
		},
		pipelineVersion,
		embeddingFingerprint
	});

	for (const url of urls) {
		await db.insert(ingestionJobItems).values({
			id: buildItemId(),
			jobId: id,
			url,
			sourceType: inferSourceTypeFromUrl(url),
			status: 'pending',
			attempts: 0
		});
	}

	await appendIngestionJobEvent(id, 'job_created', {
		urlCount: urls.length,
		concurrency,
		pipelineVersion,
		embeddingFingerprint,
		workerDefaultKeys: Object.keys(workerDefaults)
	});

	void tickIngestionJob(id);
	return { id, merged: false };
}

function terminalRunStatus(s: string): boolean {
	return s === 'done' || s === 'error' || s === 'cancelled';
}

function mapChildRunToItemStatus(status: string): IngestionJobItemStatus {
	if (status === 'done') return 'done';
	if (status === 'error') return 'error';
	if (status === 'cancelled') return 'cancelled';
	if (status === 'awaiting_sync') return 'running';
	return 'running';
}

async function loadChildIngestRunState(runId: string): Promise<IngestRunState | null> {
	const mem = await ingestRunManager.getStateAsync(runId);
	if (mem) return mem;
	return neonLoadIngestRun(runId);
}

function isStuckIngestRun(run: IngestRunState): boolean {
	const wallMs = parseInt(process.env.INGEST_JOB_ITEM_MAX_WALL_MS ?? '0', 10);
	const staleMs = parseInt(process.env.INGEST_JOB_ITEM_STALE_MS ?? '0', 10);
	if ((!Number.isFinite(wallMs) || wallMs <= 0) && (!Number.isFinite(staleMs) || staleMs <= 0)) {
		return false;
	}
	const now = Date.now();
	if (Number.isFinite(wallMs) && wallMs > 0 && now - run.createdAt > wallMs) return true;
	if (Number.isFinite(staleMs) && staleMs > 0) {
		const last = run.lastOutputAt ?? run.createdAt;
		if (now - last > staleMs) return true;
	}
	return false;
}

/**
 * Refresh job item rows from child ingest run state and recompute job summary / terminal status.
 * Does **not** launch new child runs — safe for high-frequency admin GET polling.
 */
export async function reconcileIngestionJobView(jobId: string): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	let job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId)
	});
	if (!job) return;

	if (job.status === 'done') {
		const open = await db
			.select({ id: ingestionJobItems.id })
			.from(ingestionJobItems)
			.where(
				and(
					eq(ingestionJobItems.jobId, jobId),
					or(eq(ingestionJobItems.status, 'pending'), eq(ingestionJobItems.status, 'running'))
				)
			)
			.limit(1);
		if (open.length === 0) return;
		await db
			.update(ingestionJobs)
			.set({ status: 'running', completedAt: null, updatedAt: new Date() })
			.where(eq(ingestionJobs.id, jobId));
		job = { ...job, status: 'running', completedAt: null };
	}

	if (job.status !== 'running') return;

	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));

	const wasAllTerminalBefore =
		items.length > 0 &&
		items.every((r) => r.status !== 'pending' && r.status !== 'running');

	// Refresh running items from child runs (terminal, or stuck → error)
	for (const it of items) {
		if (it.status !== 'running' || !it.childRunId) continue;
		const run = await loadChildIngestRunState(it.childRunId);
		if (!run) continue;

		if (!terminalRunStatus(run.status)) {
			if (isStuckIngestRun(run)) {
				const errMsg = `ingest_stuck_timeout: child run still non-terminal after ${Math.round((Date.now() - run.createdAt) / 60_000)}m (INGEST_JOB_ITEM_MAX_WALL_MS / INGEST_JOB_ITEM_STALE_MS)`;
				await db
					.update(ingestionJobItems)
					.set({
						status: 'error',
						lastError: errMsg,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_stuck', {
					itemId: it.id,
					url: it.url,
					childRunId: it.childRunId,
					error: errMsg
				});
			}
			continue;
		}

		const nextStatus = mapChildRunToItemStatus(run.status);
		const err = run.status === 'error' ? run.error ?? 'Run failed' : null;
		await db
			.update(ingestionJobItems)
			.set({
				status: nextStatus,
				lastError: err,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await appendIngestionJobEvent(jobId, 'item_terminal', {
			itemId: it.id,
			url: it.url,
			status: nextStatus,
			childRunId: it.childRunId,
			error: err
		});
	}

	await applyAutoRequeueForJobErrors(jobId);
	await syncDlqForExhaustedJobItems(jobId);

	const refreshed = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));

	const summary = {
		total: refreshed.length,
		pending: refreshed.filter((r) => r.status === 'pending').length,
		running: refreshed.filter((r) => r.status === 'running').length,
		done: refreshed.filter((r) => r.status === 'done').length,
		error: refreshed.filter((r) => r.status === 'error').length,
		cancelled: refreshed.filter((r) => r.status === 'cancelled').length,
		skipped: refreshed.filter((r) => r.status === 'skipped').length
	};

	const allTerminal =
		summary.pending === 0 && summary.running === 0 && summary.total > 0;
	const jobStatus = allTerminal ? 'done' : 'running';

	await db
		.update(ingestionJobs)
		.set({
			summary,
			status: jobStatus,
			updatedAt: new Date(),
			completedAt: allTerminal ? new Date() : null
		})
		.where(eq(ingestionJobs.id, jobId));

	if (allTerminal && !wasAllTerminalBefore) {
		await appendIngestionJobEvent(jobId, 'job_completed', { summary });
	}
}

export async function tickIngestionJob(jobId: string): Promise<void> {
	const prev = tickIngestionJobTailByJobId.get(jobId) ?? Promise.resolve();
	const run = prev.catch(() => {}).then(() => tickIngestionJobUnlocked(jobId));
	tickIngestionJobTailByJobId.set(jobId, run);
	await run;
}

async function tickIngestionJobUnlocked(jobId: string): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	await reconcileIngestionJobView(jobId);
	const db = getDrizzleDb();
	const job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId)
	});
	if (!job || job.status !== 'running') return;

	const refreshed = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));

	const summary = {
		total: refreshed.length,
		pending: refreshed.filter((r) => r.status === 'pending').length,
		running: refreshed.filter((r) => r.status === 'running').length,
		done: refreshed.filter((r) => r.status === 'done').length,
		error: refreshed.filter((r) => r.status === 'error').length,
		cancelled: refreshed.filter((r) => r.status === 'cancelled').length,
		skipped: refreshed.filter((r) => r.status === 'skipped').length
	};

	/** Runs in Surreal store (no LLM) do not consume a job concurrency slot. */
	let llmSlotOccupants = 0;
	const runningCount = refreshed.filter((it) => it.status === 'running').length;
	for (const it of refreshed) {
		if (it.status !== 'running' || !it.childRunId) continue;
		const child = await loadChildIngestRunState(it.childRunId);
		if (ingestRunStillOccupiesLlmConcurrencySlot(child)) llmSlotOccupants += 1;
	}
	const slots = computeIngestionJobTickSpawnCap({
		jobConcurrency: job.concurrency,
		llmSlotOccupants,
		runningItemCount: runningCount
	});
	const pendingItems = await db
		.select()
		.from(ingestionJobItems)
		.where(
			and(
				eq(ingestionJobItems.jobId, jobId),
				eq(ingestionJobItems.status, 'pending'),
				or(isNull(ingestionJobItems.blockedUntil), lte(ingestionJobItems.blockedUntil, new Date()))
			)
		)
		.orderBy(asc(ingestionJobItems.updatedAt));

	for (let i = 0; i < slots && i < pendingItems.length; i++) {
		if (i > 0) {
			const j = ingestJobLaunchJitterMs();
			if (j > 0) await sleepMs(Math.floor(Math.random() * (j + 1)));
		}
		const it = pendingItems[i]!;
		const jobDefaultsRaw =
			job.workerDefaults && typeof job.workerDefaults === 'object' && !Array.isArray(job.workerDefaults)
				? job.workerDefaults
				: {};
		const jobBatchOverrides = sanitizeIngestionJobWorkerDefaults(jobDefaultsRaw) ?? {};
		const batchOverrides = { ...jobBatchOverrides };
		if (batchOverrides.ingestProvider === undefined) {
			batchOverrides.ingestProvider = 'auto';
		}
		const payload: IngestRunPayload = {
			source_url: it.url,
			source_type: it.sourceType,
			validate: job.validateLlm === true,
			stop_before_store: false,
			embedding_model: CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL,
			model_chain: { extract: 'auto', relate: 'auto', group: 'auto', validate: 'auto' },
			queue_record_id: it.queueRecordId ?? undefined,
			pipeline_version: job.pipelineVersion ?? undefined,
			embedding_fingerprint: job.embeddingFingerprint ?? undefined,
			ingestion_job_id: jobId,
			batch_overrides: batchOverrides
		};
		const existingRunId = it.childRunId?.trim();
		if (existingRunId) {
			const prior = await loadChildIngestRunState(existingRunId);
			if (!prior) {
				await db
					.update(ingestionJobItems)
					.set({ childRunId: null, updatedAt: new Date() })
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_stale_run_cleared', {
					itemId: it.id,
					url: it.url,
					previousChildRunId: existingRunId,
					reason: 'missing_ingest_run_row'
				});
			} else if (prior.status === 'error') {
				const resumed = await ingestRunManager.resumeFromFailure(existingRunId);
				if (resumed.ok) {
					await db
						.update(ingestionJobItems)
						.set({
							status: 'running',
							lastError: null,
							blockedUntil: null,
							launchThrottleCount: 0,
							updatedAt: new Date()
						})
						.where(eq(ingestionJobItems.id, it.id));
					await appendIngestionJobEvent(jobId, 'item_resumed_checkpoint', {
						itemId: it.id,
						url: it.url,
						childRunId: existingRunId,
						source: 'job_tick'
					});
					continue;
				}
				await db
					.update(ingestionJobItems)
					.set({
						status: 'pending',
						childRunId: null,
						lastError: resumed.error ?? 'resume_failed',
						blockedUntil: null,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_resume_failed', {
					itemId: it.id,
					url: it.url,
					previousChildRunId: existingRunId,
					childRunIdCleared: true,
					error: resumed.error
				});
				continue;
			} else if (prior.status === 'done') {
				await db
					.update(ingestionJobItems)
					.set({
						status: 'done',
						lastError: null,
						blockedUntil: null,
						launchThrottleCount: 0,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_heal_terminal_child', {
					itemId: it.id,
					url: it.url,
					childRunId: existingRunId,
					childStatus: 'done'
				});
				continue;
			} else if ((prior.status as string) === 'cancelled') {
				await db
					.update(ingestionJobItems)
					.set({ childRunId: null, updatedAt: new Date() })
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_stale_run_cleared', {
					itemId: it.id,
					url: it.url,
					previousChildRunId: existingRunId,
					reason: 'child_cancelled'
				});
			} else {
				await db
					.update(ingestionJobItems)
					.set({
						status: 'running',
						lastError: null,
						blockedUntil: null,
						launchThrottleCount: 0,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_heal_non_terminal_child', {
					itemId: it.id,
					url: it.url,
					childRunId: existingRunId,
					childStatus: prior.status
				});
				continue;
			}
		}
		try {
			const childRunId = await ingestRunManager.createRun(payload, job.actorEmail ?? 'ingestion-job@sophia.local');
			await db
				.update(ingestionJobItems)
				.set({
					status: 'running',
					childRunId,
					attempts: it.attempts + 1,
					lastError: null,
					blockedUntil: null,
					launchThrottleCount: 0,
					updatedAt: new Date()
				})
				.where(eq(ingestionJobItems.id, it.id));
			await appendIngestionJobEvent(jobId, 'item_started', {
				itemId: it.id,
				url: it.url,
				childRunId
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (isLaunchThrottleError(msg)) {
				const throttleCount = (it.launchThrottleCount ?? 0) + 1;
				const until = new Date(Date.now() + computeLaunchThrottleBackoffMs(throttleCount));
				await db
					.update(ingestionJobItems)
					.set({
						status: 'pending',
						blockedUntil: until,
						lastError: msg,
						launchThrottleCount: throttleCount,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_launch_throttled', {
					itemId: it.id,
					url: it.url,
					error: msg,
					blockedUntil: until.toISOString(),
					launchThrottleCount: throttleCount
				});
			} else {
				await db
					.update(ingestionJobItems)
					.set({
						status: 'error',
						lastError: msg,
						attempts: it.attempts + 1,
						updatedAt: new Date()
					})
					.where(eq(ingestionJobItems.id, it.id));
				await appendIngestionJobEvent(jobId, 'item_launch_error', {
					itemId: it.id,
					url: it.url,
					error: msg
				});
			}
		}
	}

	await reconcileIngestionJobView(jobId);
}

/** One pass equivalent to `scripts/ingestion-job-poller.ts --once` (all running jobs). */
/** Jobs that are `running`, or `done` but still have pending/running items (heal edge cases). */
async function listJobIdsNeedingTick(): Promise<string[]> {
	const db = getDrizzleDb();
	const running = await db
		.select({ id: ingestionJobs.id })
		.from(ingestionJobs)
		.where(eq(ingestionJobs.status, 'running'));
	const doneWithWork = await db
		.select({ id: ingestionJobs.id })
		.from(ingestionJobs)
		.innerJoin(ingestionJobItems, eq(ingestionJobItems.jobId, ingestionJobs.id))
		.where(
			and(
				eq(ingestionJobs.status, 'done'),
				or(eq(ingestionJobItems.status, 'pending'), eq(ingestionJobItems.status, 'running'))
			)
		);
	const ids = new Set<string>();
	for (const r of running) ids.add(r.id);
	for (const r of doneWithWork) ids.add(r.id);
	return [...ids];
}

/** Advance all jobs that need ticking. Returns how many job ids were processed. */
export async function tickAllRunningIngestionJobs(): Promise<number> {
	if (!isNeonIngestPersistenceEnabled()) return 0;
	const orphan = await sweepWorkerOrphanIngestRuns();
	if (orphan.terminalized > 0) {
		console.log(
			`[ingestion-jobs] worker_orphan: examined=${orphan.examined} terminalized=${orphan.terminalized} auto_resumed=${orphan.autoResumed}`
		);
	}
	await sweepStalledIngestRuns();
	await applyDlqAutoReplayIfEnabled();
	const ids = await listJobIdsNeedingTick();
	for (const id of ids) {
		await tickIngestionJob(id);
	}
	return ids.length;
}

export type IngestionJobRetryMode = 'restart' | 'resume';

/**
 * `restart`: failed items → pending, new child runs on next tick (fixes bad deploy, launch errors, full redo).
 * `resume`: failed items with childRunId → ingestRunManager.resumeFromFailure (continues ingest.ts from Surreal checkpoint).
 */
export async function retryIngestionJob(
	jobId: string,
	mode: IngestionJobRetryMode,
	opts?: { itemId?: string; onlyDlq?: boolean }
): Promise<
	| {
			ok: true;
			touched: number;
			resumeResults?: { runId: string; ok: boolean; error?: string }[];
	  }
	| { ok: false; error: string }
> {
	if (!isNeonIngestPersistenceEnabled()) return { ok: false, error: 'Neon ingest persistence is not enabled.' };
	const db = getDrizzleDb();
	const job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId)
	});
	if (!job) return { ok: false, error: 'Job not found.' };

	let items = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));

	if (opts?.itemId?.trim()) {
		const id = opts.itemId.trim();
		items = items.filter((i) => i.id === id);
		if (items.length === 0) return { ok: false, error: 'Item not found on this job.' };
	}

	const failed = items.filter((i) => i.status === 'error');
	const target = opts?.onlyDlq === true ? failed.filter((i) => i.dlqEnqueuedAt != null) : failed;
	if (target.length === 0) {
		if (failed.length === 0) {
			return { ok: false, error: opts?.itemId ? 'That item is not in error state.' : 'No failed items to retry.' };
		}
		return {
			ok: false,
			error:
				opts?.onlyDlq === true
					? 'No DLQ items to retry (dead-letter rows have dlq_enqueued_at set after max attempts).'
					: 'No failed items to retry.'
		};
	}

	await db
		.update(ingestionJobs)
		.set({
			status: 'running',
			completedAt: null,
			updatedAt: new Date()
		})
		.where(eq(ingestionJobs.id, jobId));

	if (mode === 'restart') {
		for (const it of target) {
			await db
				.update(ingestionJobItems)
				.set({
					status: 'pending',
					childRunId: null,
					lastError: null,
					blockedUntil: null,
					launchThrottleCount: 0,
					dlqEnqueuedAt: null,
					lastFailureKind: null,
					failureClass: null,
					updatedAt: new Date()
				})
				.where(eq(ingestionJobItems.id, it.id));
		}
		await appendIngestionJobEvent(jobId, 'job_retry_restart', {
			mode: 'restart',
			itemCount: target.length,
			itemIds: target.map((i) => i.id),
			onlyDlq: opts?.onlyDlq === true
		});
		await tickIngestionJob(jobId);
		return { ok: true, touched: target.length };
	}

	// resume
	const withRun = target.filter((i) => Boolean(i.childRunId?.trim()));
	const withoutRun = target.filter((i) => !i.childRunId?.trim());
	if (withRun.length === 0) {
		return {
			ok: false,
			error:
				'No failed items have a child ingest run (e.g. launch failed before a run id). Use “Restart failed” instead.'
		};
	}

	const resumeResults: { runId: string; ok: boolean; error?: string }[] = [];
	for (const it of withRun) {
		const runId = it.childRunId!.trim();
		const result = await ingestRunManager.resumeFromFailure(runId);
		if (result.ok) {
			await db
				.update(ingestionJobItems)
				.set({
					status: 'running',
					lastError: null,
					updatedAt: new Date()
				})
				.where(eq(ingestionJobItems.id, it.id));
			resumeResults.push({ runId, ok: true });
		} else {
			resumeResults.push({ runId, ok: false, error: result.error });
		}
	}

	await appendIngestionJobEvent(jobId, 'job_retry_resume', {
		mode: 'resume',
		itemCount: withRun.length,
		skippedNoRunId: withoutRun.map((i) => i.id),
		results: resumeResults,
		onlyDlq: opts?.onlyDlq === true
	});

	await tickIngestionJob(jobId);

	const okCount = resumeResults.filter((r) => r.ok).length;
	if (okCount === 0) {
		const msg = resumeResults.map((r) => r.error ?? 'unknown').join('; ');
		return { ok: false, error: msg || 'Resume failed for all items.' };
	}

	return { ok: true, touched: okCount, resumeResults };
}

export type IngestionJobItemModifyAction = 'requeue_to_pending' | 'cancel';

/**
 * Operator actions on a single job item from the admin job detail screen.
 * - `requeue_to_pending`: failed item → pending without incrementing attempts (unblocks cap / manual retry).
 * - `cancel`: terminal abandon — error items become `cancelled`; running items kill the child run then reconcile.
 */
export async function modifyIngestionJobItem(
	jobId: string,
	itemId: string,
	action: IngestionJobItemModifyAction
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!isNeonIngestPersistenceEnabled()) return { ok: false, error: 'Neon ingest persistence is not enabled.' };
	const id = itemId.trim();
	if (!id) return { ok: false, error: 'Missing item id.' };

	const db = getDrizzleDb();
	const [it] = await db
		.select()
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), eq(ingestionJobItems.id, id)))
		.limit(1);
	if (!it) return { ok: false, error: 'Item not found on this job.' };

	if (action === 'requeue_to_pending') {
		if (it.status !== 'error') {
			return { ok: false, error: 'Only items in error state can be moved back to pending.' };
		}
		await db
			.update(ingestionJobItems)
			.set({
				status: 'pending',
				childRunId: null,
				lastError: null,
				blockedUntil: null,
				launchThrottleCount: 0,
				dlqEnqueuedAt: null,
				lastFailureKind: null,
				failureClass: null,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, id));
		await db
			.update(ingestionJobs)
			.set({ status: 'running', completedAt: null, updatedAt: new Date() })
			.where(eq(ingestionJobs.id, jobId));
		await appendIngestionJobEvent(jobId, 'item_requeued_manual', {
			itemId: id,
			url: it.url,
			reason: 'operator_pending'
		});
		void tickIngestionJob(jobId);
		return { ok: true };
	}

	// cancel
	if (it.status === 'error') {
		await db
			.update(ingestionJobItems)
			.set({
				status: 'cancelled',
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, id));
		await appendIngestionJobEvent(jobId, 'item_cancelled', {
			itemId: id,
			url: it.url,
			fromStatus: 'error'
		});
		await reconcileIngestionJobView(jobId);
		return { ok: true };
	}

	if (it.status === 'running' && it.childRunId?.trim()) {
		const cancel = ingestRunManager.cancelRun(it.childRunId.trim());
		if (!cancel.ok) {
			return { ok: false, error: cancel.error };
		}
		await reconcileIngestionJobView(jobId);
		return { ok: true };
	}

	return { ok: false, error: 'Only error or in-flight (running) items can be cancelled from this action.' };
}

const JOB_CANCELLED_ITEM_NOTE = 'job_cancelled_by_operator';

/**
 * Stop a durable ingestion job: no further URLs launch, pending items are cancelled, running items
 * are abandoned (child `ingest_runs` rows updated in Neon so workers cannot claim queued children).
 * Idempotent if the job is already `cancelled`.
 */
export async function cancelEntireIngestionJob(
	jobId: string
): Promise<
	| {
			ok: true;
			previousStatus: string;
			pendingCancelled: number;
			runningAbandoned: number;
	  }
	| { ok: false; error: string }
> {
	if (!isNeonIngestPersistenceEnabled()) return { ok: false, error: 'Neon ingest persistence is not enabled.' };
	const id = jobId.trim();
	if (!id) return { ok: false, error: 'Missing job id.' };

	const db = getDrizzleDb();
	const job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, id)
	});
	if (!job) return { ok: false, error: 'Job not found.' };

	if (job.status === 'cancelled') {
		return { ok: true, previousStatus: 'cancelled', pendingCancelled: 0, runningAbandoned: 0 };
	}

	const items = await db.select().from(ingestionJobItems).where(eq(ingestionJobItems.jobId, id));
	const pendingItems = items.filter((i) => i.status === 'pending');
	const runningItems = items.filter((i) => i.status === 'running');
	const hasOpen = pendingItems.length > 0 || runningItems.length > 0;

	if (job.status === 'done' && !hasOpen) {
		return { ok: false, error: 'Job is already finished.' };
	}

	await db
		.update(ingestionJobs)
		.set({ status: 'cancelled', updatedAt: new Date(), completedAt: new Date() })
		.where(eq(ingestionJobs.id, id));

	let pendingCancelled = 0;
	for (const it of pendingItems) {
		await db
			.update(ingestionJobItems)
			.set({
				status: 'cancelled',
				lastError: JOB_CANCELLED_ITEM_NOTE,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		pendingCancelled += 1;
	}

	let runningAbandoned = 0;
	for (const it of runningItems) {
		const rid = it.childRunId?.trim();
		if (rid) {
			await neonAbandonIngestRunForJobCancel(rid);
		}
		await db
			.update(ingestionJobItems)
			.set({
				status: 'cancelled',
				lastError: rid ? JOB_CANCELLED_ITEM_NOTE : 'job_cancelled_no_child_run',
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		runningAbandoned += 1;
	}

	const refreshed = await db.select().from(ingestionJobItems).where(eq(ingestionJobItems.jobId, id));
	const summary = {
		total: refreshed.length,
		pending: refreshed.filter((r) => r.status === 'pending').length,
		running: refreshed.filter((r) => r.status === 'running').length,
		done: refreshed.filter((r) => r.status === 'done').length,
		error: refreshed.filter((r) => r.status === 'error').length,
		cancelled: refreshed.filter((r) => r.status === 'cancelled').length,
		skipped: refreshed.filter((r) => r.status === 'skipped').length
	};

	await db
		.update(ingestionJobs)
		.set({
			summary,
			updatedAt: new Date(),
			completedAt: new Date()
		})
		.where(eq(ingestionJobs.id, id));

	await appendIngestionJobEvent(id, 'job_cancelled', {
		previousStatus: job.status,
		pendingCancelled,
		runningAbandoned,
		summary
	});

	return { ok: true, previousStatus: job.status, pendingCancelled, runningAbandoned };
}

export type IngestionJobRow = InferSelectModel<typeof ingestionJobs>;
export type IngestionJobItemRow = InferSelectModel<typeof ingestionJobItems>;
export type IngestionJobEventRow = InferSelectModel<typeof ingestionJobEvents>;

export type IngestJobChildRunSummary = {
	itemId: string;
	childRunId: string;
	url: string;
	runStatus: string;
	validate: boolean;
	extractionModel: string | null;
	avgFaithfulness: number | null;
	issueCount: number;
};

/** Aggregated `ingest_run_issues` for all child runs still linked on this job (pipeline tuning / validation exercises). */
export type IngestJobIssuePipelineRecentRow = {
	runId: string;
	url: string | null;
	seq: number;
	kind: string;
	severity: string;
	stageHint: string | null;
	message: string;
	createdAt: string | null;
};

export type IngestJobIssuePipelineSignals = {
	totalIssues: number;
	/** Same child runs as `totalIssues`, excluding routine `[RESUME]` checkpoint rows (`resume_checkpoint`). */
	totalIssuesLessResume: number;
	byKind: Record<string, number>;
	byStageHint: Record<string, number>;
	recent: IngestJobIssuePipelineRecentRow[];
};

async function loadIngestJobIssuePipelineSignals(jobId: string): Promise<IngestJobIssuePipelineSignals> {
	const db = getDrizzleDb();
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), isNotNull(ingestionJobItems.childRunId)));
	const runIdToUrl = new Map<string, string>();
	for (const it of items) {
		const rid = it.childRunId?.trim();
		if (!rid) continue;
		if (!runIdToUrl.has(rid)) runIdToUrl.set(rid, it.url);
	}
	const runIds = [...runIdToUrl.keys()];
	if (runIds.length === 0) {
		return { totalIssues: 0, totalIssuesLessResume: 0, byKind: {}, byStageHint: {}, recent: [] };
	}
	const [totalRow] = await db
		.select({ n: sql<number>`count(*)::int`.mapWith(Number) })
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds));
	const totalIssues = totalRow?.n ?? 0;
	const [lessResumeRow] = await db
		.select({
			n: sql<number>`count(*) FILTER (WHERE ${ingestRunIssues.kind} <> 'resume_checkpoint')::int`.mapWith(
				Number
			)
		})
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds));
	const totalIssuesLessResume = lessResumeRow?.n ?? 0;
	const kindRows = await db
		.select({
			kind: ingestRunIssues.kind,
			n: sql<number>`count(*)::int`.mapWith(Number)
		})
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds))
		.groupBy(ingestRunIssues.kind);
	const stageRows = await db
		.select({
			stageHint: ingestRunIssues.stageHint,
			n: sql<number>`count(*)::int`.mapWith(Number)
		})
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds))
		.groupBy(ingestRunIssues.stageHint);
	const byKind: Record<string, number> = {};
	for (const r of kindRows) {
		byKind[r.kind] = r.n;
	}
	const byStageHint: Record<string, number> = {};
	for (const r of stageRows) {
		const key = r.stageHint?.trim() ? r.stageHint.trim() : '(unknown)';
		byStageHint[key] = (byStageHint[key] ?? 0) + r.n;
	}
	const recentRows = await db
		.select({
			runId: ingestRunIssues.runId,
			seq: ingestRunIssues.seq,
			kind: ingestRunIssues.kind,
			severity: ingestRunIssues.severity,
			stageHint: ingestRunIssues.stageHint,
			message: ingestRunIssues.message,
			createdAt: ingestRunIssues.createdAt
		})
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds))
		.orderBy(desc(ingestRunIssues.createdAt), desc(ingestRunIssues.seq))
		.limit(60);
	const recent: IngestJobIssuePipelineRecentRow[] = recentRows.map((r) => ({
		runId: r.runId,
		url: runIdToUrl.get(r.runId) ?? null,
		seq: r.seq,
		kind: r.kind,
		severity: r.severity,
		stageHint: r.stageHint,
		message: r.message,
		createdAt: r.createdAt?.toISOString() ?? null
	}));
	return { totalIssues, totalIssuesLessResume, byKind, byStageHint, recent };
}

async function loadIngestJobChildRunSummaries(jobId: string): Promise<IngestJobChildRunSummary[]> {
	const db = getDrizzleDb();
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), isNotNull(ingestionJobItems.childRunId)));
	const withRun = items.filter((i) => typeof i.childRunId === 'string' && i.childRunId.trim());
	const runIds = [...new Set(withRun.map((i) => i.childRunId!.trim()))];
	if (runIds.length === 0) return [];

	const runs = await db.select().from(ingestRuns).where(inArray(ingestRuns.id, runIds));
	const byRunId = new Map(runs.map((r) => [r.id, r]));

	const avgRows = await db
		.select({
			runId: ingestStagingValidation.runId,
			avg: sql<number>`avg(${ingestStagingValidation.faithfulnessScore})`.mapWith(Number)
		})
		.from(ingestStagingValidation)
		.where(inArray(ingestStagingValidation.runId, runIds))
		.groupBy(ingestStagingValidation.runId);
	const avgByRun = new Map(avgRows.map((r) => [r.runId, r.avg]));

	const issueRows = await db
		.select({
			runId: ingestRunIssues.runId,
			n: sql<number>`count(*)::int`.mapWith(Number)
		})
		.from(ingestRunIssues)
		.where(inArray(ingestRunIssues.runId, runIds))
		.groupBy(ingestRunIssues.runId);
	const issuesByRun = new Map(issueRows.map((r) => [r.runId, r.n]));

	const out: IngestJobChildRunSummary[] = [];
	for (const it of withRun) {
		const rid = it.childRunId!.trim();
		const r = byRunId.get(rid);
		const payload =
			r?.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)
				? (r.payload as Record<string, unknown>)
				: {};
		const validate = payload.validate === true;
		const envelope =
			r?.reportEnvelope && typeof r.reportEnvelope === 'object' && !Array.isArray(r.reportEnvelope)
				? (r.reportEnvelope as Record<string, unknown>)
				: null;
		const tt = envelope?.timingTelemetry;
		let extractionModel: string | null = null;
		if (tt && typeof tt === 'object' && !Array.isArray(tt)) {
			const sm = (tt as Record<string, unknown>).stage_models;
			if (sm && typeof sm === 'object' && !Array.isArray(sm)) {
				const ex = (sm as Record<string, unknown>).extraction;
				if (typeof ex === 'string' && ex.trim()) extractionModel = ex.trim();
			}
		}
		const rawAvg = avgByRun.get(rid);
		const avgFaithfulness =
			typeof rawAvg === 'number' && Number.isFinite(rawAvg) ? Math.round(rawAvg * 10) / 10 : null;
		out.push({
			itemId: it.id,
			childRunId: rid,
			url: it.url,
			runStatus: r?.status ?? '(unknown)',
			validate,
			extractionModel,
			avgFaithfulness,
			issueCount: issuesByRun.get(rid) ?? 0
		});
	}
	return out;
}

export async function getIngestionJobDetail(jobId: string): Promise<{
	job: IngestionJobRow;
	items: IngestionJobItemRow[];
	childRunSummaries: IngestJobChildRunSummary[];
	issuePipelineSignals: IngestJobIssuePipelineSignals;
} | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const db = getDrizzleDb();
	const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId)).limit(1);
	if (!job) return null;
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));
	const [childRunSummaries, issuePipelineSignals] = await Promise.all([
		loadIngestJobChildRunSummaries(jobId),
		loadIngestJobIssuePipelineSignals(jobId)
	]);
	return { job, items, childRunSummaries, issuePipelineSignals };
}

export async function listRecentIngestionJobs(limit: number): Promise<IngestionJobRow[]> {
	if (!isNeonIngestPersistenceEnabled()) return [];
	const db = getDrizzleDb();
	const cap = Math.max(1, Math.min(100, limit));
	return db
		.select()
		.from(ingestionJobs)
		.orderBy(desc(ingestionJobs.updatedAt))
		.limit(cap);
}

export async function listIngestionJobEvents(
	jobId: string,
	opts?: { sinceSeq?: number; limit?: number }
): Promise<IngestionJobEventRow[]> {
	if (!isNeonIngestPersistenceEnabled()) return [];
	const db = getDrizzleDb();
	const lim = Math.max(1, Math.min(500, opts?.limit ?? 200));
	const since = opts?.sinceSeq ?? 0;
	return db
		.select()
		.from(ingestionJobEvents)
		.where(and(eq(ingestionJobEvents.jobId, jobId), gt(ingestionJobEvents.seq, since)))
		.orderBy(ingestionJobEvents.seq)
		.limit(lim);
}
