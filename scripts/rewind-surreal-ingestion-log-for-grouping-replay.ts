/**
 * Align Surreal `ingestion_log` with a disk partial rewound to post–Stage 2 (relating, no `arguments`)
 * so `pnpm exec tsx --env-file=.env.local scripts/ingest.ts <source> --force-stage grouping --stop-after-embedding`
 * actually executes Stage 3 (see docs/local/operations/ingest-grouping-knobs-bml.md — apples-to-apples repro).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/rewind-surreal-ingestion-log-for-grouping-replay.ts
 *   pnpm exec tsx --env-file=.env.local scripts/rewind-surreal-ingestion-log-for-grouping-replay.ts "https://plato.stanford.edu/entries/foo"
 */
import { Surreal } from 'surrealdb';
import { resolveSurrealRpcUrl } from '../src/lib/server/surrealEnv.js';
import { signinSurrealWithFallback } from './lib/surrealSignin.js';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';
import { ingestionLogStatusReflectingCheckpoint } from '../src/lib/server/ingestion/ingestResumeStage.js';

const DEFAULT_URL = 'https://plato.stanford.edu/entries/descartes-epistemology';

function buildSourceUrlCandidates(sourceUrl: string): string[] {
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) return [sourceUrl];
	const candidates = new Set<string>([identity.canonicalUrl]);
	try {
		const parsed = new URL(identity.canonicalUrl);
		if (parsed.pathname.length > 1 && !parsed.pathname.endsWith('/')) {
			const withSlash = new URL(identity.canonicalUrl);
			withSlash.pathname = `${withSlash.pathname}/`;
			candidates.add(withSlash.toString());
		} else if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
			const noSlash = new URL(identity.canonicalUrl);
			noSlash.pathname = noSlash.pathname.replace(/\/$/, '');
			candidates.add(noSlash.toString());
		}
	} catch {
		/* ignore */
	}
	return [...candidates];
}

async function main(): Promise<void> {
	const rawUrl = (process.argv[2] ?? DEFAULT_URL).trim();
	const identity = canonicalizeAndHashSourceUrl(rawUrl);
	if (!identity) {
		throw new Error(`Invalid or uncanonicalizable URL: ${rawUrl}`);
	}

	const stageCompleted = 'relating';
	const status = ingestionLogStatusReflectingCheckpoint(stageCompleted);
	const sourceUrls = buildSourceUrlCandidates(rawUrl);

	const db = new Surreal();
	await db.connect(resolveSurrealRpcUrl());
	await signinSurrealWithFallback(db);
	await db.use({
		namespace: process.env.SURREAL_NAMESPACE || 'sophia',
		database: process.env.SURREAL_DATABASE || 'sophia'
	});

	const result = await db.query(
		`UPDATE ingestion_log SET
			stage_completed = $stage_completed,
			status = $status,
			error_message = NONE
		WHERE source_url INSIDE $source_urls
		   OR canonical_url_hash = $canonical_url_hash`,
		{
			stage_completed: stageCompleted,
			status,
			source_urls: sourceUrls,
			canonical_url_hash: identity.canonicalUrlHash
		}
	);

	console.log('[OK] ingestion_log rewind query finished:', {
		canonical_url: identity.canonicalUrl,
		canonical_url_hash: identity.canonicalUrlHash,
		stage_completed: stageCompleted,
		status,
		rawResult: result
	});

	const check = await db.query<
		Array<Array<{ source_url?: string; stage_completed?: string; status?: string }>>
	>(
		`SELECT source_url, canonical_url, stage_completed, status FROM ingestion_log
		 WHERE canonical_url_hash = $canonical_url_hash OR source_url INSIDE $source_urls
		 LIMIT 1`,
		{ canonical_url_hash: identity.canonicalUrlHash, source_urls: sourceUrls }
	);
	const row = Array.isArray(check?.[0]) ? check[0][0] : undefined;
	if (!row) {
		console.warn(
			'[WARN] No ingestion_log row matched — create one by running ingest once, or check URL / hash.'
		);
	} else {
		console.log('[CHECK] Current row:', row);
	}

	await db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
