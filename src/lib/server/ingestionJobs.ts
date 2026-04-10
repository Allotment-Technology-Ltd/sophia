/**
 * Durable multi-URL ingestion jobs (Neon). Ticks launch child runs via ingestRunManager.
 */

import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDrizzleDb } from './db/neon';
import { ingestionJobEvents, ingestionJobItems, ingestionJobs } from './db/schema';
import { neonLoadIngestRun } from './db/ingestRunRepository';
import { isNeonIngestPersistenceEnabled } from './neon/datastore';
import { inferSourceTypeFromUrl, ingestRunManager, type IngestRunPayload } from './ingestRuns';
import { resolveEmbeddingFingerprint, resolvePipelineVersion } from './ingestionPipelineMetadata';

const ADV_LOCK_JOB_EVENTS = 5_849_273;

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
	const concurrency = Math.max(1, Math.min(8, args.concurrency ?? 2));
	const pipelineVersion = resolvePipelineVersion();
	const embeddingFingerprint = resolveEmbeddingFingerprint();
	const urls = [...new Set(args.urls.map((u) => u.trim()).filter(Boolean))];
	if (urls.length === 0) throw new Error('At least one URL is required');

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

export async function tickIngestionJob(jobId: string): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	const job = await db.query.ingestionJobs.findFirst({
		where: eq(ingestionJobs.id, jobId)
	});
	if (!job || job.status !== 'running') return;

	const items = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));

	// Refresh running items from child runs
	for (const it of items) {
		if (it.status !== 'running' || !it.childRunId) continue;
		let nextStatus: IngestionJobItemStatus | null = null;
		let err: string | null = null;

		const mem = await ingestRunManager.getStateAsync(it.childRunId);
		if (mem) {
			if (terminalRunStatus(mem.status)) {
				nextStatus = mapChildRunToItemStatus(mem.status);
				err = mem.status === 'error' ? mem.error ?? 'Run failed' : null;
			}
		} else {
			const durable = await neonLoadIngestRun(it.childRunId);
			if (durable && terminalRunStatus(durable.status)) {
				nextStatus = mapChildRunToItemStatus(durable.status);
				err = durable.status === 'error' ? durable.error ?? 'Run failed' : null;
			}
		}

		if (nextStatus) {
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
	}

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
	const pendingItems = refreshed.filter((r) => r.status === 'pending');

	for (let i = 0; i < slots && i < pendingItems.length; i++) {
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

	const finalItems = await db
		.select()
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.jobId, jobId));
	const finalSummary = {
		total: finalItems.length,
		pending: finalItems.filter((r) => r.status === 'pending').length,
		running: finalItems.filter((r) => r.status === 'running').length,
		done: finalItems.filter((r) => r.status === 'done').length,
		error: finalItems.filter((r) => r.status === 'error').length,
		cancelled: finalItems.filter((r) => r.status === 'cancelled').length,
		skipped: finalItems.filter((r) => r.status === 'skipped').length
	};

	const allTerminal =
		finalSummary.pending === 0 &&
		finalSummary.running === 0 &&
		finalSummary.total > 0;
	const jobStatus = allTerminal ? 'done' : 'running';

	await db
		.update(ingestionJobs)
		.set({
			summary: finalSummary,
			status: jobStatus,
			updatedAt: new Date(),
			completedAt: allTerminal ? new Date() : null
		})
		.where(eq(ingestionJobs.id, jobId));

	if (allTerminal) {
		await appendIngestionJobEvent(jobId, 'job_completed', { summary: finalSummary });
	}
}

/** One pass equivalent to `scripts/ingestion-job-poller.ts --once` (all running jobs). */
export async function tickAllRunningIngestionJobs(): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	const rows = await db
		.select({ id: ingestionJobs.id })
		.from(ingestionJobs)
		.where(eq(ingestionJobs.status, 'running'));
	for (const r of rows) {
		await tickIngestionJob(r.id);
	}
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
