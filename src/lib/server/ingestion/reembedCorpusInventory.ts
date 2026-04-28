/**
 * Read-only Surreal inventory for claim.embedding dimensions (migration / admin UI).
 */

import { query as surrealQuery } from '$lib/server/db';

export type EmbeddingDimBucket = {
	dim: number | null;
	count: number;
};

export type SourceNonTargetCount = {
	sourceId: string;
	count: number;
};

export type ReembedCorpusInventory = {
	targetDim: number;
	noneCount: number;
	dimBuckets: EmbeddingDimBucket[];
	needsWorkCount: number;
	perSourceNonTarget: SourceNonTargetCount[];
};

type ReembedCorpusInventoryOptions = {
	/** Limit number of sources returned in perSourceNonTarget. */
	perSourceLimit?: number;
	/** Cache TTL to avoid hammering Surreal from admin UI refresh loops. */
	cacheTtlMs?: number;
};

export type ReembedCorpusInventoryQueryTimingsMs = {
	countWhereNone: number;
	dimBuckets: number;
	countNeedsWork: number;
	perSourceNonTarget: number;
};

export type ReembedCorpusInventoryWithDiagnostics = {
	inventory: ReembedCorpusInventory;
	queryMs: ReembedCorpusInventoryQueryTimingsMs;
};

async function countWhereNone(): Promise<number> {
	const rows = await surrealQuery<Array<{ count: number }>>(
		'SELECT count() AS count FROM claim WHERE embedding IS NONE GROUP ALL'
	);
	const r = Array.isArray(rows) ? rows[0] : rows;
	return r && typeof r.count === 'number' ? r.count : 0;
}

/** Buckets by array::len(embedding) for non-null embeddings. */
async function dimBuckets(): Promise<EmbeddingDimBucket[]> {
	const rows = await surrealQuery<Array<{ dim: number; count: number }>>(
		`SELECT array::len(embedding) AS dim, count() AS count
     FROM claim
     WHERE embedding IS NOT NONE
     GROUP BY dim`
	);
	const list = Array.isArray(rows) ? rows : [];
	return list
		.map((r) => ({
			dim: Number.isFinite(r.dim) ? r.dim : null,
			count: typeof r.count === 'number' ? r.count : 0
		}))
		.filter((b) => b.count > 0)
		.sort((a, b) => (a.dim ?? -1) - (b.dim ?? -1));
}

async function countNeedsWork(targetDim: number): Promise<number> {
	const rows = await surrealQuery<Array<{ count: number }>>(
		`SELECT count() AS count FROM claim
     WHERE embedding IS NONE OR array::len(embedding) != $target_dim
     GROUP ALL`,
		{ target_dim: targetDim }
	);
	const r = Array.isArray(rows) ? rows[0] : rows;
	return r && typeof r.count === 'number' ? r.count : 0;
}

/** Per-source counts for claims that are not yet target_dim (including NONE). */
async function perSourceNonTarget(targetDim: number, limit: number): Promise<SourceNonTargetCount[]> {
	const rows = await surrealQuery<Array<{ source: string; count: number }>>(
		`SELECT source, count() AS count FROM claim
     WHERE embedding IS NONE OR array::len(embedding) != $target_dim
     GROUP BY source
     ORDER BY count DESC
     LIMIT $limit`,
		{ target_dim: targetDim, limit }
	);
	const list = Array.isArray(rows) ? rows : [];
	return list
		.map((r) => ({
			sourceId: typeof r.source === 'string' ? r.source : String(r.source),
			count: typeof r.count === 'number' ? r.count : 0
		}))
		.filter((r) => r.count > 0)
		.sort((a, b) => b.count - a.count);
}

let cached:
	| { targetDim: number; fetchedAtMs: number; ttlMs: number; value: ReembedCorpusInventory }
	| null = null;

export async function getReembedCorpusInventory(
	targetDim: number,
	options?: ReembedCorpusInventoryOptions
): Promise<ReembedCorpusInventory> {
	const perSourceLimit = Math.max(0, Math.trunc(options?.perSourceLimit ?? 60));
	const cacheTtlMs = Math.max(0, Math.trunc(options?.cacheTtlMs ?? 30_000));

	if (
		cached &&
		cacheTtlMs > 0 &&
		cached.targetDim === targetDim &&
		cached.ttlMs === cacheTtlMs &&
		Date.now() - cached.fetchedAtMs < cacheTtlMs
	) {
		return cached.value;
	}

	const [noneCount, buckets, needsWorkCount, perSourceNonTargetRows] = await Promise.all([
		countWhereNone(),
		dimBuckets(),
		countNeedsWork(targetDim),
		perSourceLimit > 0 ? perSourceNonTarget(targetDim, perSourceLimit) : Promise.resolve([])
	]);
	const value: ReembedCorpusInventory = {
		targetDim,
		noneCount,
		dimBuckets: buckets,
		needsWorkCount,
		perSourceNonTarget: perSourceNonTargetRows
	};
	if (cacheTtlMs > 0) {
		cached = { targetDim, fetchedAtMs: Date.now(), ttlMs: cacheTtlMs, value };
	}
	return value;
}

export async function getReembedCorpusInventoryWithDiagnostics(
	targetDim: number,
	options?: ReembedCorpusInventoryOptions
): Promise<ReembedCorpusInventoryWithDiagnostics> {
	const perSourceLimit = Math.max(0, Math.trunc(options?.perSourceLimit ?? 60));
	const cacheTtlMs = Math.max(0, Math.trunc(options?.cacheTtlMs ?? 30_000));

	const t0 = Date.now();
	const noneP = countWhereNone().then((v) => ({ v, ms: Date.now() - t0 }));

	const t1 = Date.now();
	const bucketsP = dimBuckets().then((v) => ({ v, ms: Date.now() - t1 }));

	const t2 = Date.now();
	const needsP = countNeedsWork(targetDim).then((v) => ({ v, ms: Date.now() - t2 }));

	const t3 = Date.now();
	const perSourceP =
		perSourceLimit > 0
			? perSourceNonTarget(targetDim, perSourceLimit).then((v) => ({ v, ms: Date.now() - t3 }))
			: Promise.resolve({ v: [], ms: 0 });

	const [none, buckets, needs, perSource] = await Promise.all([noneP, bucketsP, needsP, perSourceP]);
	const inventory: ReembedCorpusInventory = {
		targetDim,
		noneCount: none.v,
		dimBuckets: buckets.v,
		needsWorkCount: needs.v,
		perSourceNonTarget: perSource.v
	};

	if (cacheTtlMs > 0) {
		cached = { targetDim, fetchedAtMs: Date.now(), ttlMs: cacheTtlMs, value: inventory };
	}

	return {
		inventory,
		queryMs: {
			countWhereNone: none.ms,
			dimBuckets: buckets.ms,
			countNeedsWork: needs.ms,
			perSourceNonTarget: perSource.ms
		}
	};
}
