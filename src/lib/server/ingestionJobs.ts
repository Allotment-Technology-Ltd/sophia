/**
 * Durable multi-URL ingestion jobs (Neon). Ticks launch child runs via ingestRunManager.
 */

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDrizzleDb } from './db/neon';
import { ingestionJobEvents, ingestionJobItems, ingestionJobs } from './db/schema';
import { neonLoadIngestRun } from './db/ingestRunRepository';
import { isNeonIngestPersistenceEnabled } from './neon/datastore';
import {
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
import { resolveEmbeddingFingerprint, resolvePipelineVersion } from './ingestionPipelineMetadata';
import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';

const ADV_LOCK_JOB_EVENTS = 5_849_273;

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

/** Convert eligible `error` rows to `pending` (back of queue via newer `updatedAt`). */
async function applyAutoRequeueForJobErrors(jobId: string): Promise<void> {
	const db = getDrizzleDb();
	const maxA = getIngestionJobItemMaxAttempts();
	const rows = await db
		.select()
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), eq(ingestionJobItems.status, 'error')));
	for (const it of rows) {
		if (!canAutoRequeueAfterFailure(it.attempts)) continue;
		if (!shouldAutoRequeueIngestJobItem(it.lastError)) continue;
		await db
			.update(ingestionJobItems)
			.set({
				status: 'pending',
				childRunId: null,
				blockedUntil: null,
				updatedAt: new Date()
			})
			.where(eq(ingestionJobItems.id, it.id));
		await appendIngestionJobEvent(jobId, 'item_requeued_auto', {
			itemId: it.id,
			url: it.url,
			attempts: it.attempts,
			maxAttempts: maxA,
			reason: 'retry_after_failure'
		});
	}
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
};

export async function createIngestionJob(args: CreateIngestionJobArgs): Promise<{ id: string } | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const db = getDrizzleDb();
	const id = buildJobId();
	const concurrency = Math.max(
		1,
		Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, args.concurrency ?? 2)
	);
	const pipelineVersion = resolvePipelineVersion();
	const embeddingFingerprint = resolveEmbeddingFingerprint();
	const urls = [...new Set(args.urls.map((u) => u.trim()).filter(Boolean))];
	if (urls.length === 0) throw new Error('At least one URL is required');

	if ((process.env.INGEST_JOB_PREFLIGHT ?? '').trim() === '1') {
		await runIngestionJobPreflightOrThrow();
	}

	await db.insert(ingestionJobs).values({
		id,
		status: 'running',
		concurrency,
		actorUid: args.actorUid,
		actorEmail: args.actorEmail,
		notes: args.notes ?? null,
		validateLlm: args.validate === true,
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
		embeddingFingerprint
	});

	void tickIngestionJob(id);
	return { id };
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

	const runningCount = summary.running;
	const slots = Math.max(0, job.concurrency - runningCount);
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
		const payload: IngestRunPayload = {
			source_url: it.url,
			source_type: it.sourceType,
			validate: job.validateLlm === true,
			stop_before_store: false,
			model_chain: { extract: 'auto', relate: 'auto', group: 'auto', validate: 'auto' },
			queue_record_id: it.queueRecordId ?? undefined,
			pipeline_version: job.pipelineVersion ?? undefined,
			embedding_fingerprint: job.embeddingFingerprint ?? undefined
		};
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
	opts?: { itemId?: string }
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
	if (failed.length === 0) {
		return { ok: false, error: opts?.itemId ? 'That item is not in error state.' : 'No failed items to retry.' };
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
		for (const it of failed) {
			await db
				.update(ingestionJobItems)
				.set({
					status: 'pending',
					childRunId: null,
					lastError: null,
					blockedUntil: null,
					updatedAt: new Date()
				})
				.where(eq(ingestionJobItems.id, it.id));
		}
		await appendIngestionJobEvent(jobId, 'job_retry_restart', {
			mode: 'restart',
			itemCount: failed.length,
			itemIds: failed.map((i) => i.id)
		});
		await tickIngestionJob(jobId);
		return { ok: true, touched: failed.length };
	}

	// resume
	const withRun = failed.filter((i) => Boolean(i.childRunId?.trim()));
	const withoutRun = failed.filter((i) => !i.childRunId?.trim());
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
		results: resumeResults
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

export type IngestionJobRow = InferSelectModel<typeof ingestionJobs>;
export type IngestionJobItemRow = InferSelectModel<typeof ingestionJobItems>;
export type IngestionJobEventRow = InferSelectModel<typeof ingestionJobEvents>;

export async function getIngestionJobDetail(jobId: string): Promise<{
	job: IngestionJobRow;
	items: IngestionJobItemRow[];
} | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const db = getDrizzleDb();
	const [job] = await db.select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId)).limit(1);
	if (!job) return null;
	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));
	return { job, items };
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
