/**
 * Offline fleet tuning report — aggregates Neon `ingest_runs.report_envelope` timingTelemetry
 * and applies the same rule-based `buildIngestMetricsAdvisory` as live runs (no LLM).
 *
 *   pnpm ops:ingest-tuning-report-neon
 *   pnpm exec tsx --env-file=.env scripts/reports-ingest-tuning-neon.ts -- --days=30
 *
 * Read-only; requires DATABASE_URL. Log-line heuristics are omitted here (envelope has no stdout);
 * for per-run log signals use Neon `ingest_run_logs` processors or re-open the run in Admin.
 */

import { and, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns } from '../src/lib/server/db/schema.ts';
import { buildIngestMetricsAdvisory } from '../src/lib/server/ingestion/ingestRunMetricsAdvisor.ts';

type UnknownRecord = Record<string, unknown>;

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 30;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 30;
	return n;
}

async function main(): Promise<void> {
	loadServerEnv();
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}
	const db = getDrizzleDb();

	const rows = await db
		.select({
			id: ingestRuns.id,
			status: ingestRuns.status,
			completedAt: ingestRuns.completedAt,
			sourceUrl: ingestRuns.sourceUrl,
			reportEnvelope: ingestRuns.reportEnvelope
		})
		.from(ingestRuns)
		.where(
			and(
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`
			)
		);

	let withTiming = 0;
	const sevCount = { ok: 0, watch: 0, action: 0, unknown: 0 };
	const recTotals = new Map<string, number>();
	let sumRetries = 0;
	let sumSplits = 0;
	let runsCounted = 0;

	for (const r of rows) {
		const env = r.reportEnvelope as UnknownRecord | null | undefined;
		const tt = env?.timingTelemetry as UnknownRecord | undefined;
		if (!tt || typeof tt !== 'object') continue;
		withTiming += 1;
		const adv = buildIngestMetricsAdvisory(tt, {});
		if (adv.severity === 'ok') sevCount.ok += 1;
		else if (adv.severity === 'watch') sevCount.watch += 1;
		else if (adv.severity === 'action') sevCount.action += 1;
		else sevCount.unknown += 1;
		for (const line of adv.recommendations) {
			recTotals.set(line, (recTotals.get(line) ?? 0) + 1);
		}
		sumRetries += adv.signals.model_retries ?? 0;
		sumSplits += adv.signals.batch_splits ?? 0;
		runsCounted += 1;
	}

	console.log(`── Ingest tuning report (Neon, last ${days}d, cancelled=false, completed not null) ──`);
	console.log(`  ingest_runs rows scanned:  ${rows.length}`);
	console.log(`  with timingTelemetry:      ${withTiming}`);
	console.log('');
	console.log('── Advisory severity (recomputed from timing only; no log-line scan) ──');
	console.log(`  ok:      ${sevCount.ok}`);
	console.log(`  watch:   ${sevCount.watch}`);
	console.log(`  action:  ${sevCount.action}`);
	console.log('');
	if (runsCounted > 0) {
		console.log(
			`  mean model_retries / run: ${(sumRetries / runsCounted).toFixed(2)}  ·  mean batch_splits / run: ${(sumSplits / runsCounted).toFixed(2)}`
		);
		console.log('');
	}

	const topRec = [...recTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
	console.log('── Top recommendation strings (dedupe by exact text) ──');
	if (topRec.length === 0) {
		console.log('  (none — widen window or ensure report_envelope.timingTelemetry is populated)');
	} else {
		for (const [text, c] of topRec) {
			console.log(`  [${c}×] ${text}`);
		}
	}
	console.log('');
	console.log('── Next steps ──');
	console.log('  • Per-run log signals (429 / [SPLIT] / [PREEMPT]): query ingest_run_logs or use Admin → View report after re-sync.');
	console.log('  • Worker stdout always includes [INGEST_METRICS_ADVISORY] on successful timing flush.');
	console.log('  • LLM recovery stays optional (INGEST_RECOVERY_AGENT=1); this report never calls an LLM.');
	console.log('');
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
});
