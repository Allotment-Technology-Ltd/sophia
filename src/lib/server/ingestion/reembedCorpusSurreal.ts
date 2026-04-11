/**
 * Surreal HTTP SQL helpers for corpus re-embed (index + claim updates).
 * Index DDL mirrors scripts/lib/surrealClaimVectorIndex.ts (HNSW → MTREE fallback).
 */

import { query as surrealQuery } from '$lib/server/db';
import {
	buildHnswClaimEmbeddingDefineSql,
	buildMtreeClaimEmbeddingDefineSql,
	parseIndexMode,
	removeClaimEmbeddingIndexSql
} from '../../../../scripts/lib/surrealClaimVectorIndex.js';

export type ClaimRowForReembed = { id: string; text: string };

export async function surrealRemoveClaimEmbeddingIndex(): Promise<void> {
	await surrealQuery(removeClaimEmbeddingIndexSql());
}

export async function surrealDefineClaimEmbeddingIndex(dimension: number): Promise<{ kind: 'hnsw' | 'mtree' }> {
	const mode = parseIndexMode();
	if (mode === 'mtree') {
		await surrealQuery(buildMtreeClaimEmbeddingDefineSql(dimension));
		return { kind: 'mtree' };
	}
	if (mode === 'hnsw') {
		await surrealQuery(buildHnswClaimEmbeddingDefineSql(dimension));
		return { kind: 'hnsw' };
	}
	try {
		await surrealQuery(buildHnswClaimEmbeddingDefineSql(dimension));
		return { kind: 'hnsw' };
	} catch (hnswErr) {
		console.warn(
			'[reembed] HNSW index failed; falling back to MTREE:',
			hnswErr instanceof Error ? hnswErr.message : String(hnswErr)
		);
		await surrealQuery(buildMtreeClaimEmbeddingDefineSql(dimension));
		return { kind: 'mtree' };
	}
}

/** Next slice of claims that still need the target dimension (always LIMIT from START 0 — rows leave the filter as they are updated). */
export async function surrealFetchReembedBatch(targetDim: number, limit: number): Promise<ClaimRowForReembed[]> {
	const rows = await surrealQuery<ClaimRowForReembed[]>(
		`SELECT id, text FROM claim
     WHERE embedding IS NONE OR array::len(embedding) != $target_dim
     ORDER BY id
     LIMIT $limit`,
		{ target_dim: targetDim, limit }
	);
	return Array.isArray(rows) ? rows : [];
}

export async function surrealUpdateClaimEmbedding(claimId: string, embedding: number[]): Promise<void> {
	await surrealQuery('UPDATE type::thing($id) SET embedding = $embedding RETURN NONE', {
		id: claimId,
		embedding
	});
}
