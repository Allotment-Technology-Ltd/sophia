/**
 * Audit SurrealDB `claim.embedding` vector index and dimension alignment with the app.
 *
 * Usage: tsx --env-file=.env scripts/audit-surreal-vector-index.ts [--json]
 *
 * Exit 1 if SURREAL_VECTOR_AUDIT_STRICT=1 and:
 *   - claim_embedding index is missing, or
 *   - stored embedding lengths disagree with getEmbeddingDimensions().
 */

import { Surreal } from 'surrealdb';
import { getEmbeddingDimensions } from '../src/lib/server/embeddings.js';
import { CLAIM_EMBEDDING_INDEX_NAME } from './lib/surrealClaimVectorIndex.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const strict =
	(process.env.SURREAL_VECTOR_AUDIT_STRICT ?? '').trim().toLowerCase() === '1' ||
	(process.env.SURREAL_VECTOR_AUDIT_STRICT ?? '').trim().toLowerCase() === 'true';

const jsonOut = process.argv.includes('--json');

type InfoForTable = {
	indexes?: Record<string, { sql?: string }>;
};

function parseDimensionFromIndexSql(sql: string | undefined): number | null {
	if (!sql) return null;
	const m = sql.match(/\bDIMENSION\s+(\d+)/i);
	return m?.[1] ? parseInt(m[1], 10) : null;
}

function indexKindFromSql(sql: string | undefined): 'hnsw' | 'mtree' | 'unknown' {
	if (!sql) return 'unknown';
	if (/\bHNSW\b/i.test(sql)) return 'hnsw';
	if (/\bMTREE\b/i.test(sql)) return 'mtree';
	return 'unknown';
}

async function main(): Promise<void> {
	const expectedDim = getEmbeddingDimensions();
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	try {
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	} catch {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	}
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });

	const infoRows = await db.query<[InfoForTable]>(`INFO FOR TABLE claim`);
	const info = Array.isArray(infoRows?.[0]) ? infoRows[0][0] : infoRows?.[0];
	const idxEntry = info?.indexes?.[CLAIM_EMBEDDING_INDEX_NAME];
	const indexSql = idxEntry?.sql;
	const indexDim = parseDimensionFromIndexSql(indexSql);
	const indexKind = indexKindFromSql(indexSql);

	const countRows = await db.query<[{ count: number }]>(
		'SELECT count() AS count FROM claim WHERE embedding IS NOT NONE GROUP ALL'
	);
	const withEmb =
		Array.isArray(countRows?.[0]) && countRows[0][0]?.count != null
			? Number(countRows[0][0].count)
			: 0;

	const sampleRows = await db.query<Array<{ dim: number }>>(
		'SELECT array::len(embedding) AS dim FROM claim WHERE embedding IS NOT NONE LIMIT 50'
	);
	const sampleList = Array.isArray(sampleRows?.[0]) ? sampleRows[0] : [];
	const dims = new Set(sampleList.map((r) => r.dim).filter((n) => Number.isFinite(n)));
	const singleDim = dims.size === 1 ? [...dims][0]! : null;
	const dimMismatch = dims.size > 1 || (singleDim !== null && singleDim !== expectedDim);
	const dataDimOk = withEmb === 0 || !dimMismatch;

	const indexPresent = Boolean(indexSql);
	const indexDimOk = !indexPresent || indexDim === null || indexDim === expectedDim;

	const issues: string[] = [];
	if (!indexPresent) issues.push(`Missing index "${CLAIM_EMBEDDING_INDEX_NAME}" on claim`);
	if (indexPresent && indexDim !== null && indexDim !== expectedDim) {
		issues.push(`Index DIMENSION ${indexDim} != app getEmbeddingDimensions() ${expectedDim}`);
	}
	if (withEmb > 0 && dimMismatch) {
		issues.push(`Inconsistent embedding lengths in sample (dims: ${[...dims].join(', ')})`);
	}
	if (withEmb > 0 && singleDim !== null && singleDim !== expectedDim) {
		issues.push(`Stored embedding length ${singleDim} != expected ${expectedDim}`);
	}

	let explainNote: string | null = null;
	if (indexPresent && withEmb > 0) {
		const probe = Array(expectedDim).fill(0);
		try {
			const ex = await db.query(
				`SELECT id FROM claim WHERE embedding <|3,64|> $q LIMIT 1 EXPLAIN FULL`,
				{ q: probe }
			);
			explainNote = JSON.stringify(ex?.[0] ?? ex).slice(0, 500);
		} catch (e) {
			explainNote =
				`EXPLAIN probe failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	const ok = issues.length === 0;

	const report = {
		ok,
		expectedDim,
		index: {
			name: CLAIM_EMBEDDING_INDEX_NAME,
			present: indexPresent,
			kind: indexKind,
			indexDimension: indexDim,
			sql: indexSql ?? null
		},
		data: {
			claimsWithEmbedding: withEmb,
			sampleDistinctDims: [...dims],
			dataDimOk
		},
		checks: {
			indexDimOk,
			indexPresent
		},
		issues,
		explainSnippet: explainNote
	};

	if (jsonOut) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(`[audit] Expected embedding dimension (app): ${expectedDim}`);
		console.log(
			`[audit] Index "${CLAIM_EMBEDDING_INDEX_NAME}": ${indexPresent ? 'present' : 'MISSING'}${indexPresent ? ` (${indexKind}${indexDim != null ? `, DIMENSION ${indexDim}` : ''})` : ''}`
		);
		if (indexSql && !jsonOut) console.log(`[audit] Index SQL: ${indexSql}`);
		console.log(`[audit] Claims with embedding: ${withEmb}`);
		if (dims.size) console.log(`[audit] Sample dims (up to 50 rows): ${[...dims].join(', ')}`);
		for (const issue of issues) console.warn(`[audit] ISSUE: ${issue}`);
		if (explainNote) console.log(`[audit] EXPLAIN probe: ${explainNote}`);
		console.log(ok ? '[audit] OK' : '[audit] FAILED');
	}

	await db.close();

	if (!ok && strict) {
		process.exit(1);
	}
}

main().catch((e) => {
	console.error('[audit] Fatal:', e instanceof Error ? e.message : e);
	process.exit(1);
});
