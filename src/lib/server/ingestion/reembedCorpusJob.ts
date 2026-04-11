/**
 * Neon-backed durable re-embed job: Surreal claim.embedding → runtime embedding dimension (e.g. 1024 Voyage).
 */

import { randomBytes } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDrizzleDb } from '$lib/server/db/neon';
import { reembedJobEvents, reembedJobs } from '$lib/server/db/schema';
import { embedTexts, getEmbeddingDimensions } from '$lib/server/embeddings';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { getReembedCorpusInventory } from './reembedCorpusInventory';
import {
	surrealDefineClaimEmbeddingIndex,
	surrealFetchReembedBatch,
	surrealRemoveClaimEmbeddingIndex,
	surrealUpdateClaimEmbedding
} from './reembedCorpusSurreal';

const ADV_LOCK_REEMBED_EVENTS = 5_849_275;

type ReembedStage =
	| 'pending'
	| 'remove_index'
	| 'embedding'
	| 'create_index'
	| 'done'
	| 'error'
	| 'cancelled';

function buildJobId(): string {
	return `reembed_job_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

export async function appendReembedJobEvent(
	jobId: string,
	eventType: string,
	payload: Record<string, unknown> | null
): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADV_LOCK_REEMBED_EVENTS}, hashtext(${jobId}))`);
		const [row] = await tx
			.select({ m: sql<number>`COALESCE(MAX(${reembedJobEvents.seq}), 0)`.mapWith(Number) })
			.from(reembedJobEvents)
			.where(eq(reembedJobEvents.jobId, jobId));
		const nextSeq = (row?.m ?? 0) + 1;
		await tx.insert(reembedJobEvents).values({
			jobId,
			seq: nextSeq,
			eventType,
			payload
		});
	});
}

export type CreateReembedJobArgs = {
	actorEmail: string | null;
	batchSize?: number;
};

export async function createReembedJob(args: CreateReembedJobArgs): Promise<{ id: string } | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const targetDim = getEmbeddingDimensions();
	const db = getDrizzleDb();

	const existing = await db
		.select({ id: reembedJobs.id })
		.from(reembedJobs)
		.where(and(eq(reembedJobs.status, 'running')))
		.limit(1);
	if (existing.length > 0) {
		throw new Error(`A re-embed job is already running (${existing[0]!.id}). Cancel or wait for it to finish.`);
	}

	const pendingOthers = await db
		.select({ id: reembedJobs.id })
		.from(reembedJobs)
		.where(eq(reembedJobs.status, 'pending'))
		.limit(1);
	if (pendingOthers.length > 0) {
		throw new Error(`A re-embed job is already queued (${pendingOthers[0]!.id}).`);
	}

	const id = buildJobId();
	const batchSize = Math.max(1, Math.min(500, args.batchSize ?? 50));

	await db.insert(reembedJobs).values({
		id,
		status: 'pending',
		targetDim,
		stage: 'pending',
		processedCount: 0,
		totalCount: null,
		cursorOffset: 0,
		batchSize,
		lastError: null,
		actorEmail: args.actorEmail,
		summary: {}
	});

	await appendReembedJobEvent(id, 'job_created', { targetDim, batchSize });
	void tickReembedJob(id);
	return { id };
}

export async function cancelReembedJob(jobId: string): Promise<boolean> {
	if (!isNeonIngestPersistenceEnabled()) return false;
	const db = getDrizzleDb();
	const job = await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) });
	if (!job || job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
		return false;
	}
	await db
		.update(reembedJobs)
		.set({
			status: 'cancelled',
			stage: 'cancelled',
			lastError: 'Cancelled by operator',
			updatedAt: new Date(),
			completedAt: new Date(),
			summary: { ...(typeof job.summary === 'object' && job.summary ? job.summary : {}), cancelled: true }
		})
		.where(eq(reembedJobs.id, jobId));
	await appendReembedJobEvent(jobId, 'job_cancelled', {});
	return true;
}

export async function tickReembedJob(jobId: string): Promise<void> {
	if (!isNeonIngestPersistenceEnabled()) return;
	const db = getDrizzleDb();
	const job = await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) });
	if (!job) return;
	if (job.status === 'cancelled' || job.status === 'done' || job.status === 'error') return;

	const targetDim = job.targetDim;
	const summary = (typeof job.summary === 'object' && job.summary && !Array.isArray(job.summary)
		? job.summary
		: {}) as Record<string, unknown>;
	if (summary.cancelled === true) return;

	try {
		if (job.status === 'pending' && job.stage === 'pending') {
			await db
				.update(reembedJobs)
				.set({ status: 'running', stage: 'remove_index', updatedAt: new Date() })
				.where(eq(reembedJobs.id, jobId));
			await appendReembedJobEvent(jobId, 'stage', { stage: 'remove_index' });
		}

		const j = await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) });
		if (!j || j.status === 'cancelled') return;
		const stage = j.stage as ReembedStage;

		if (stage === 'remove_index') {
			try {
				await surrealRemoveClaimEmbeddingIndex();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (!/not found|no such|does not exist/i.test(msg)) {
					throw e;
				}
			}
			const inv = await getReembedCorpusInventory(targetDim);
			await db
				.update(reembedJobs)
				.set({
					stage: 'embedding',
					totalCount: inv.needsWorkCount,
					updatedAt: new Date()
				})
				.where(eq(reembedJobs.id, jobId));
			await appendReembedJobEvent(jobId, 'index_removed', {
				needsWorkCount: inv.needsWorkCount,
				noneCount: inv.noneCount
			});
		}

		const j2 = await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) });
		if (!j2 || j2.status === 'cancelled') return;

		if (j2.stage === 'embedding') {
			const batch = await surrealFetchReembedBatch(targetDim, j2.batchSize);
			if (batch.length === 0) {
				await db
					.update(reembedJobs)
					.set({ stage: 'create_index', updatedAt: new Date() })
					.where(eq(reembedJobs.id, jobId));
				await appendReembedJobEvent(jobId, 'embedding_complete', { processed: j2.processedCount });
				await tickReembedJob(jobId);
				return;
			}

			const texts = batch.map((r) => r.text);
			const vectors = await embedTexts(texts);

			for (let i = 0; i < batch.length; i++) {
				const row = batch[i]!;
				const vec = vectors[i];
				if (!vec || vec.length !== targetDim) {
					throw new Error(
						`Embedding dimension mismatch for ${row.id}: expected ${targetDim}, got ${vec?.length ?? 0}`
					);
				}
				await surrealUpdateClaimEmbedding(row.id, vec);
			}

			const newProcessed = j2.processedCount + batch.length;
			await db
				.update(reembedJobs)
				.set({
					processedCount: newProcessed,
					cursorOffset: newProcessed,
					updatedAt: new Date()
				})
				.where(eq(reembedJobs.id, jobId));
			await appendReembedJobEvent(jobId, 'batch', {
				size: batch.length,
				processed: newProcessed,
				total: j2.totalCount
			});
			return;
		}

		const j3 = await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) });
		if (!j3 || j3.status === 'cancelled') return;

		if (j3.stage === 'create_index') {
			const { kind } = await surrealDefineClaimEmbeddingIndex(targetDim);
			await db
				.update(reembedJobs)
				.set({
					stage: 'done',
					status: 'done',
					completedAt: new Date(),
					updatedAt: new Date(),
					lastError: null
				})
				.where(eq(reembedJobs.id, jobId));
			await appendReembedJobEvent(jobId, 'index_created', { kind, dimension: targetDim });
			await appendReembedJobEvent(jobId, 'job_completed', { processed: j3.processedCount });
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await db
			.update(reembedJobs)
			.set({
				status: 'error',
				stage: 'error',
				lastError: msg,
				updatedAt: new Date(),
				completedAt: new Date()
			})
			.where(eq(reembedJobs.id, jobId));
		await appendReembedJobEvent(jobId, 'job_error', { error: msg });
	}
}

/** Advance any pending or running re-embed job (poller / manual tick). */
export async function tickAllRunningReembedJobs(): Promise<number> {
	if (!isNeonIngestPersistenceEnabled()) return 0;
	const db = getDrizzleDb();
	const rows = await db
		.select({ id: reembedJobs.id })
		.from(reembedJobs)
		.where(or(eq(reembedJobs.status, 'running'), eq(reembedJobs.status, 'pending')));
	let n = 0;
	for (const r of rows) {
		await tickReembedJob(r.id);
		n++;
	}
	return n;
}

export type ReembedJobRow = InferSelectModel<typeof reembedJobs>;
export type ReembedJobEventRow = InferSelectModel<typeof reembedJobEvents>;

export async function listReembedJobs(limit: number): Promise<ReembedJobRow[]> {
	if (!isNeonIngestPersistenceEnabled()) return [];
	const db = getDrizzleDb();
	const cap = Math.max(1, Math.min(50, limit));
	return db.select().from(reembedJobs).orderBy(desc(reembedJobs.createdAt)).limit(cap);
}

export async function getReembedJob(jobId: string): Promise<ReembedJobRow | null> {
	if (!isNeonIngestPersistenceEnabled()) return null;
	const db = getDrizzleDb();
	return (await db.query.reembedJobs.findFirst({ where: eq(reembedJobs.id, jobId) })) ?? null;
}

export async function listReembedJobEvents(jobId: string, limit: number): Promise<ReembedJobEventRow[]> {
	if (!isNeonIngestPersistenceEnabled()) return [];
	const db = getDrizzleDb();
	const cap = Math.max(1, Math.min(500, limit));
	const rows = await db
		.select()
		.from(reembedJobEvents)
		.where(eq(reembedJobEvents.jobId, jobId))
		.orderBy(desc(reembedJobEvents.seq))
		.limit(cap);
	return rows.reverse();
}
