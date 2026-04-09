/**
 * Shared SurrealQL for `claim.embedding` vector index (HNSW vs MTREE).
 * Used by setup-schema, restore-vectors, reembed-corpus, and audit.
 */

import type { Surreal } from 'surrealdb';
import { getEmbeddingDimensions } from '../../src/lib/server/embeddings.js';

export const CLAIM_EMBEDDING_INDEX_NAME = 'claim_embedding';

export type SurrealVectorIndexKind = 'hnsw' | 'mtree';

function parseIndexMode(): SurrealVectorIndexKind | 'auto' {
	const raw = (process.env.SURREAL_VECTOR_INDEX_MODE ?? 'auto').trim().toLowerCase();
	if (raw === 'hnsw' || raw === 'mtree') return raw;
	return 'auto';
}

function useConcurrentVectorIndex(): boolean {
	const v = (process.env.SURREAL_VECTOR_INDEX_CONCURRENTLY ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

export function requireVectorIndex(): boolean {
	const v = (process.env.SURREAL_REQUIRE_VECTOR_INDEX ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

export function getClaimEmbeddingDimension(): number {
	return getEmbeddingDimensions();
}

export function removeClaimEmbeddingIndexSql(): string {
	return `REMOVE INDEX ${CLAIM_EMBEDDING_INDEX_NAME} ON claim`;
}

export function buildHnswClaimEmbeddingDefineSql(dimension: number): string {
	const concurrent = useConcurrentVectorIndex();
	const tail = concurrent ? ' CONCURRENTLY' : '';
	return `DEFINE INDEX IF NOT EXISTS ${CLAIM_EMBEDDING_INDEX_NAME} ON claim FIELDS embedding HNSW DIMENSION ${dimension} TYPE F32 DIST COSINE${tail}`;
}

export function buildMtreeClaimEmbeddingDefineSql(dimension: number): string {
	const concurrent = useConcurrentVectorIndex();
	const tail = concurrent ? ' CONCURRENTLY' : '';
	return `DEFINE INDEX IF NOT EXISTS ${CLAIM_EMBEDDING_INDEX_NAME} ON claim FIELDS embedding MTREE DIMENSION ${dimension}${tail}`;
}

export interface DefineClaimEmbeddingIndexResult {
	kind: SurrealVectorIndexKind;
	sql: string;
}

/**
 * Ensures `claim_embedding` exists. `auto` tries HNSW first, then MTREE.
 */
export async function defineClaimEmbeddingIndex(
	db: Surreal,
	opts?: { dimension?: number; mode?: SurrealVectorIndexKind | 'auto' }
): Promise<DefineClaimEmbeddingIndexResult> {
	const dimension = opts?.dimension ?? getClaimEmbeddingDimension();
	const mode = opts?.mode ?? parseIndexMode();

	if (mode === 'mtree') {
		const sql = buildMtreeClaimEmbeddingDefineSql(dimension);
		await db.query(sql);
		return { kind: 'mtree', sql };
	}

	if (mode === 'hnsw') {
		const sql = buildHnswClaimEmbeddingDefineSql(dimension);
		await db.query(sql);
		return { kind: 'hnsw', sql };
	}

	try {
		const sql = buildHnswClaimEmbeddingDefineSql(dimension);
		await db.query(sql);
		return { kind: 'hnsw', sql };
	} catch (hnswErr) {
		console.warn(
			'[surreal-vector-index] HNSW index failed; falling back to MTREE:',
			hnswErr instanceof Error ? hnswErr.message : String(hnswErr)
		);
		const sql = buildMtreeClaimEmbeddingDefineSql(dimension);
		await db.query(sql);
		return { kind: 'mtree', sql };
	}
}

export { parseIndexMode, useConcurrentVectorIndex };
