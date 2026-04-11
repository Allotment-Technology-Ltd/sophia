/**
 * G0 — training-corpus volume audit: Neon (orchestration + staging) and optional Surreal (stored graph).
 *
 *   pnpm ops:audit-ingest-training-volume
 *   pnpm exec tsx scripts/audit-ingest-training-volume.ts -- --days=365
 *
 * Neon: requires DATABASE_URL.
 * Surreal: optional; if `SURREAL_URL` or (`SURREAL_INSTANCE` + `SURREAL_HOSTNAME`) is set, runs read-only counts.
 *
 * See docs/operations/ingestion-fine-tune-data-mitigation-plan.md §3.
 */

import { Surreal } from 'surrealdb';
import { sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns } from '../src/lib/server/db/schema.ts';
import { hasSurrealTargetEnv, resolveSurrealRpcUrl } from '../src/lib/server/surrealEnv.ts';
import { signinSurrealWithFallback } from './lib/surrealSignin.js';

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 90;
	return n;
}

function intRow(r: unknown, key: string): number {
	const row = (r as { rows?: Record<string, unknown>[] }).rows?.[0];
	const v = row?.[key];
	return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : Number.parseInt(String(v ?? '0'), 10) || 0;
}

async function surrealOptional(): Promise<void> {
	if (!hasSurrealTargetEnv()) {
		console.log('── SurrealDB (skipped) ──');
		console.log(
			'  Set `SURREAL_URL` and/or `SURREAL_INSTANCE` + `SURREAL_HOSTNAME` (+ `SURREAL_USER` / `SURREAL_PASS`) in `.env.local` to count sources/claims.'
		);
		console.log('');
		return;
	}

	const db = new Surreal();
	try {
		const endpoint = resolveSurrealRpcUrl();
		await db.connect(endpoint);
		await signinSurrealWithFallback(db);
		await db.use({
			namespace: process.env.SURREAL_NAMESPACE || 'sophia',
			database: process.env.SURREAL_DATABASE || 'sophia'
		});

		const totalSources = await db.query<[{ c: number }[]]>(
			'SELECT count() AS c FROM source GROUP ALL'
		);
		const totalClaims = await db.query<[{ c: number }[]]>(
			'SELECT count() AS c FROM claim GROUP ALL'
		);
		const bySource = await db.query<[{ source: unknown }[]]>(
			'SELECT source FROM claim GROUP BY source'
		);
		const sourcesWithClaims = Array.isArray(bySource[0]) ? bySource[0].length : 0;

		const sc = totalSources[0]?.[0]?.c ?? 0;
		const cc = totalClaims[0]?.[0]?.c ?? 0;

		console.log('── SurrealDB (graph store, all time in this instance) ──');
		console.log(`  sources (table):           ${sc}`);
		console.log(`  claims (table):            ${cc}`);
		console.log(`  distinct source refs w/≥1 claim (GROUP BY source): ${sourcesWithClaims}`);
		console.log(
			'  Note: not time-windowed to Neon completed_at — align exports by source url/hash when building a training manifest.'
		);
		console.log('');
	} catch (e) {
		console.log('── SurrealDB (error) ──');
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`  ${msg}`);
		if (/authentication/i.test(msg)) {
			console.error(
				'  Hint: check SURREAL_URL, SURREAL_USER, SURREAL_PASS (and surreal-ns/db headers if using HTTP SQL).'
			);
		}
		console.log('');
	} finally {
		try {
			await db.close();
		} catch {
			/* ignore */
		}
	}
}

async function main(): Promise<void> {
	loadServerEnv();
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}
	const db = getDrizzleDb();

	const summary = await db.execute(sql`
    WITH base AS (
      SELECT ir.id, ir.source_url, ir.completed_at, ir.report_envelope
      FROM ${ingestRuns} ir
      WHERE ir.status = 'done'
        AND ir.cancelled_by_user = false
        AND ir.completed_at IS NOT NULL
        AND ir.completed_at >= NOW() - (${days}::int * INTERVAL '1 day')
    )
    SELECT
      (SELECT COUNT(*)::int FROM base) AS runs_done,
      (SELECT COUNT(DISTINCT source_url)::int FROM base) AS distinct_source_urls,
      (
        SELECT COUNT(*)::int FROM base b
        INNER JOIN ingest_staging_meta m ON m.run_id = b.id
        WHERE length(trim(coalesce(m.source_text_snapshot, ''))) >= 200
      ) AS runs_with_substantial_text_snapshot,
      (
        SELECT COUNT(*)::int FROM base b
        WHERE EXISTS (SELECT 1 FROM ingest_staging_claims c WHERE c.run_id = b.id)
      ) AS runs_with_staging_claims,
      (
        SELECT COUNT(*)::int FROM base b
        WHERE b.report_envelope IS NOT NULL
          AND (b.report_envelope::jsonb) ? 'timingTelemetry'
      ) AS runs_with_timing_envelope,
      (
        SELECT COUNT(*)::int FROM (
          SELECT source_url FROM base GROUP BY source_url HAVING COUNT(*) > 1
        ) u
      ) AS distinct_urls_with_multiple_runs
  `);

	const r = intRow(summary, 'runs_done');
	const u = intRow(summary, 'distinct_source_urls');
	const txt = intRow(summary, 'runs_with_substantial_text_snapshot');
	const stg = intRow(summary, 'runs_with_staging_claims');
	const te = intRow(summary, 'runs_with_timing_envelope');
	const dup = intRow(summary, 'distinct_urls_with_multiple_runs');

	console.log(`── Neon — G0 volume (${days}d window, completed_at, status=done, not cancelled) ──`);
	console.log(`  completed ingest runs:              ${r}`);
	console.log(`  distinct source_url (proxy units):  ${u}`);
	console.log(`  runs w/ staging text snapshot ≥200 chars: ${txt}`);
	console.log(`  runs w/ ≥1 ingest_staging_claims row: ${stg}`);
	console.log(`  runs w/ report_envelope.timingTelemetry: ${te}`);
	console.log(`  distinct URLs appearing in >1 run:  ${dup}  (dedupe pressure)`);
	console.log('');
	console.log('── G0 orientation (from technical review; not a legal test) ──');
	console.log('  If distinct_source_urls (after dedupe + quality filters) is << ~300, treat spike training as blocked.');
	console.log('  Staging rows indicate you can reconstruct (input → JSON) pairs from Neon without Surreal for those runs.');
	console.log('');

	await surrealOptional();

	console.log('── Related audits ──');
	console.log('  pnpm ops:audit-ingest-extraction-models-neon   # extraction provider/model mix (G1)');
	console.log('  docs/operations/ingestion-fine-tune-data-mitigation-plan.md');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
