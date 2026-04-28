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
async function perSourceNonTarget(targetDim: number): Promise<SourceNonTargetCount[]> {
	const rows = await surrealQuery<Array<{ source: string; count: number }>>(
		`SELECT source, count() AS count FROM claim
     WHERE embedding IS NONE OR array::len(embedding) != $target_dim
     GROUP BY source`,
		{ target_dim: targetDim }
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

export async function getReembedCorpusInventory(targetDim: number): Promise<ReembedCorpusInventory> {
	const [noneCount, buckets, needsWorkCount, perSourceNonTargetRows] = await Promise.all([
		countWhereNone(),
		dimBuckets(),
		countNeedsWork(targetDim),
		perSourceNonTarget(targetDim)
	]);
	return {
		targetDim,
		noneCount,
		dimBuckets: buckets,
		needsWorkCount,
		perSourceNonTarget: perSourceNonTargetRows
	};
}
