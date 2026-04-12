/**
 * Mark all historically ingested sources as excluded from model training:
 * - Surreal: `UPDATE source SET exclude_from_model_training = true`
 * - Neon: upsert `source_training_governance` for each distinct `ingest_runs.source_url` with status `done`
 *
 *   pnpm ops:backfill-source-training-exclusion -- --dry-run
 *   pnpm ops:backfill-source-training-exclusion -- --surreal-only
 *   pnpm ops:backfill-source-training-exclusion -- --neon-only
 *
 * Requires DATABASE_URL for Neon; Surreal env same as `scripts/setup-schema.ts` / ingest.
 */

import { eq, sql } from 'drizzle-orm';
import { Surreal } from 'surrealdb';
import { signinSurrealWithFallback } from './lib/surrealSignin.js';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns, sourceTrainingGovernance } from '../src/lib/server/db/schema.ts';
import { resolveSurrealRpcUrl } from '../src/lib/server/surrealEnv.ts';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

function parseFlags(argv: string[]) {
	let dryRun = false;
	let surrealOnly = false;
	let neonOnly = false;
	for (const a of argv) {
		if (a === '--dry-run') dryRun = true;
		if (a === '--surreal-only') surrealOnly = true;
		if (a === '--neon-only') neonOnly = true;
	}
	return { dryRun, surrealOnly, neonOnly };
}

async function backfillSurreal(dryRun: boolean): Promise<void> {
	const rpcUrl = resolveSurrealRpcUrl();
	const ns = process.env.SURREAL_NAMESPACE || 'sophia';
	const dbName = process.env.SURREAL_DATABASE || 'sophia';
	const db = new Surreal();
	await db.connect(rpcUrl);
	await signinSurrealWithFallback(db);
	await db.use({ namespace: ns, database: dbName });

	const countBefore = await db.query<[{ c: number }[]]>(
		'SELECT count() AS c FROM source WHERE exclude_from_model_training = true GROUP ALL'
	);
	const before =
		Array.isArray(countBefore?.[0]) && countBefore[0][0] ? Number(countBefore[0][0].c ?? 0) : 0;

	if (dryRun) {
		const total = await db.query<[{ c: number }[]]>('SELECT count() AS c FROM source GROUP ALL');
		const t = Array.isArray(total?.[0]) && total[0][0] ? Number(total[0][0].c ?? 0) : 0;
		console.log(`[dry-run] Surreal would UPDATE all ${t} source row(s); currently ${before} marked excluded.`);
		await db.close();
		return;
	}

	try {
		await db.query(
			'DEFINE FIELD IF NOT EXISTS exclude_from_model_training ON source TYPE bool DEFAULT false'
		);
	} catch {
		/* ignore */
	}
	await db.query('UPDATE source SET exclude_from_model_training = true');
	const countAfter = await db.query<[{ c: number }[]]>(
		'SELECT count() AS c FROM source WHERE exclude_from_model_training = true GROUP ALL'
	);
	const after =
		Array.isArray(countAfter?.[0]) && countAfter[0][0] ? Number(countAfter[0][0].c ?? 0) : 0;
	console.log(`[surreal] exclude_from_model_training=true on sources (was ${before} excluded, now ${after}).`);
	await db.close();
}

async function backfillNeon(dryRun: boolean): Promise<void> {
	const url = process.env.DATABASE_URL?.trim();
	if (!url) {
		console.error('DATABASE_URL is required for Neon backfill.');
		process.exit(1);
	}
	const db = getDrizzleDb();
	const rows = await db
		.select({ sourceUrl: ingestRuns.sourceUrl })
		.from(ingestRuns)
		.where(eq(ingestRuns.status, 'done'))
		.groupBy(ingestRuns.sourceUrl);

	const note = 'backfill scripts/backfill-source-training-exclusion.ts';
	let upserted = 0;
	let skipped = 0;

	for (const r of rows) {
		const raw = r.sourceUrl?.trim();
		if (!raw) {
			skipped += 1;
			continue;
		}
		const id = canonicalizeAndHashSourceUrl(raw);
		if (!id) {
			skipped += 1;
			continue;
		}
		if (dryRun) {
			upserted += 1;
			continue;
		}
		await db
			.insert(sourceTrainingGovernance)
			.values({
				canonicalUrlHash: id.canonicalUrlHash,
				sourceUrl: id.canonicalUrl,
				excludeFromModelTraining: true,
				notes: note,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: sourceTrainingGovernance.canonicalUrlHash,
				set: {
					sourceUrl: id.canonicalUrl,
					excludeFromModelTraining: sql`${sourceTrainingGovernance.excludeFromModelTraining} OR excluded.exclude_from_model_training`,
					updatedAt: new Date()
				}
			});
		upserted += 1;
	}

	if (dryRun) {
		console.log(`[dry-run] Neon would upsert ${upserted} row(s) into source_training_governance; skipped ${skipped}.`);
	} else {
		console.log(`[neon] upserted ${upserted} row(s) into source_training_governance; skipped ${skipped}.`);
	}
}

async function main(): Promise<void> {
	loadServerEnv();
	const { dryRun, surrealOnly, neonOnly } = parseFlags(process.argv.slice(2));
	if (surrealOnly && neonOnly) {
		console.error('Use only one of --surreal-only or --neon-only.');
		process.exit(1);
	}

	const doSurreal = !neonOnly;
	const doNeon = !surrealOnly;

	if (doSurreal) {
		await backfillSurreal(dryRun);
	}
	if (doNeon) {
		await backfillNeon(dryRun);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
