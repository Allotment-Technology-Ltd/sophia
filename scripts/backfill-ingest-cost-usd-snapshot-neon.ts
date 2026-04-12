/**
 * Neon backfill — recompute `ingest_staging_meta.cost_usd_snapshot` from `ingest_runs.report_envelope`
 * timingTelemetry using the same billing rules as `scripts/ingest.ts` (Keys + Vertex Gemini 3 supplement).
 *
 * Freezes the pre-fix value once in `cost_usd_snapshot_prior` and sets `cost_usd_snapshot_backfilled_at`.
 * Requires migration `0017_ingest_staging_cost_backfill_audit.sql`.
 *
 *   pnpm ops:backfill-ingest-cost-neon -- --dry-run
 *   pnpm ops:backfill-ingest-cost-neon -- --apply
 *   pnpm exec tsx --env-file=.env scripts/backfill-ingest-cost-usd-snapshot-neon.ts -- --apply --force
 *   pnpm exec tsx --env-file=.env scripts/backfill-ingest-cost-usd-snapshot-neon.ts -- --apply --days=365
 *
 * Flags:
 *   --dry-run       Print actions only (default if neither --dry-run nor --apply is passed).
 *   --apply         Execute updates.
 *   --force         Update every completed run that has a computable timing total (even if snapshot already non-zero).
 *   --touch-mismatch Also update when the new estimate exceeds the stored snapshot by > $0.001 (under-priced history).
 *   --days=N        Only runs completed in the last N days (default 3650).
 */

import { and, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns, ingestStagingMeta } from '../src/lib/server/db/schema.ts';
import { computeIngestCostUsdFromReportEnvelope } from '../src/lib/server/ingestion/ingestRunTimingTelemetryCostUsd.ts';
import { INGEST_LLM_USD_RATE_TABLE_ID } from '../src/lib/server/ingestion/ingestLlmTokenUsdRates.ts';

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 3650;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 3650;
	return n;
}

function mainFlags(): { dryRun: boolean; apply: boolean; force: boolean; touchMismatch: boolean } {
	const argv = new Set(process.argv);
	const apply = argv.has('--apply');
	const dryRun = argv.has('--dry-run') || !apply;
	return {
		dryRun,
		apply,
		force: argv.has('--force'),
		touchMismatch: argv.has('--touch-mismatch')
	};
}

function eligibleForUpdate(params: {
	force: boolean;
	touchMismatch: boolean;
	oldSnap: number | null;
	newUsd: number;
}): boolean {
	const { force, touchMismatch, oldSnap, newUsd } = params;
	if (newUsd <= 0) return false;
	const old = oldSnap !== null && Number.isFinite(oldSnap) ? oldSnap : 0;
	if (force) return true;
	if ((old < 1e-8 || oldSnap === null) && newUsd > 1e-5) return true;
	if (touchMismatch && newUsd > old + 0.001) return true;
	return false;
}

async function main(): Promise<void> {
	loadServerEnv();
	const { dryRun, apply, force, touchMismatch } = mainFlags();
	const days = parseDays();

	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}

	const db = getDrizzleDb();

	const rows = await db
		.select({
			id: ingestRuns.id,
			completedAt: ingestRuns.completedAt,
			sourceUrl: ingestRuns.sourceUrl,
			reportEnvelope: ingestRuns.reportEnvelope,
			costUsdSnapshot: ingestStagingMeta.costUsdSnapshot,
			costUsdSnapshotPrior: ingestStagingMeta.costUsdSnapshotPrior,
			costUsdSnapshotBackfilledAt: ingestStagingMeta.costUsdSnapshotBackfilledAt
		})
		.from(ingestRuns)
		.innerJoin(ingestStagingMeta, eq(ingestStagingMeta.runId, ingestRuns.id))
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`
			)
		);

	let considered = 0;
	let wouldUpdate = 0;
	let updated = 0;

	console.log(
		`── ingest_staging_meta.cost_usd_snapshot backfill (${dryRun ? 'dry-run' : 'APPLY'}) rate_table=${INGEST_LLM_USD_RATE_TABLE_ID} days=${days} ──`
	);
	console.log(`  flags: force=${force} touch-mismatch=${touchMismatch}`);
	console.log('');

	for (const r of rows) {
		const newUsd = computeIngestCostUsdFromReportEnvelope(r.reportEnvelope);
		if (newUsd === null) continue;
		considered += 1;

		const oldSnap =
			typeof r.costUsdSnapshot === 'number' && Number.isFinite(r.costUsdSnapshot)
				? r.costUsdSnapshot
				: null;

		if (!eligibleForUpdate({ force, touchMismatch, oldSnap, newUsd })) continue;
		wouldUpdate += 1;

		if (dryRun) {
			console.log(
				`  [dry-run] ${r.id}  snapshot=${oldSnap ?? 'null'}  →  ${newUsd.toFixed(4)}  prior_col=${r.costUsdSnapshotPrior ?? 'null'}  ${r.sourceUrl?.slice(0, 80) ?? ''}`
			);
			continue;
		}

		await db
			.update(ingestStagingMeta)
			.set({
				costUsdSnapshot: newUsd,
				costUsdSnapshotPrior: sql`COALESCE(${ingestStagingMeta.costUsdSnapshotPrior}, ${ingestStagingMeta.costUsdSnapshot})`,
				costUsdSnapshotBackfilledAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(ingestStagingMeta.runId, r.id));

		updated += 1;
		console.log(
			`  [updated] ${r.id}  ${oldSnap ?? 'null'} → ${newUsd.toFixed(4)}  ${r.sourceUrl?.slice(0, 80) ?? ''}`
		);
	}

	console.log('');
	console.log(`  completed runs scanned: ${rows.length}`);
	console.log(`  runs with computable timing cost: ${considered}`);
	console.log(`  ${dryRun ? 'would update' : 'updated'} rows: ${dryRun ? wouldUpdate : updated}`);
	if (dryRun && wouldUpdate > 0) {
		console.log('\n  Re-run with --apply to write Neon.');
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
