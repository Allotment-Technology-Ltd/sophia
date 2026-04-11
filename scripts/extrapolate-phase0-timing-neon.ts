/**
 * Phase 0 — broader timing estimates from Neon (envelope + `ingest_run_logs` + row E2E).
 *
 * Uses:
 * - `total_wall_ms` when present (truth) for stage / E2E fractions
 * - Else `sum(stage_ms) + planning_ms` as **attributed** denominator (ignores unattributed gaps)
 * - `completed_at - created_at` as **DB E2E** wall for runs without truth, scaled by pooled fractions
 *
 *   pnpm ops:phase0-timing-extrapolate-neon
 *   pnpm exec tsx scripts/extrapolate-phase0-timing-neon.ts -- --days=90
 *
 * Read-only; requires DATABASE_URL via loadServerEnv.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRunLogs, ingestRuns } from '../src/lib/server/db/schema.ts';

type UnknownRecord = Record<string, unknown>;

const STAGE_KEYS = [
	'extracting',
	'relating',
	'grouping',
	'embedding',
	'validating',
	'remediating',
	'storing',
	'fetching'
] as const;

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 730) return 90;
	return n;
}

function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : null;
	}
	return null;
}

function parseLastTimingPayload(linesChronological: string[]): UnknownRecord | null {
	const prefix = '[INGEST_TIMING]';
	for (let i = linesChronological.length - 1; i >= 0; i--) {
		const raw = linesChronological[i] ?? '';
		const idx = raw.lastIndexOf(prefix);
		if (idx < 0) continue;
		const jsonPart = raw.slice(idx + prefix.length).trim();
		if (!jsonPart.startsWith('{')) continue;
		try {
			const parsed = JSON.parse(jsonPart) as unknown;
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				return parsed as UnknownRecord;
			}
		} catch {
			continue;
		}
	}
	return null;
}

function stageMsFromPayload(p: UnknownRecord, key: string): number {
	const sm = p.stage_ms;
	if (!sm || typeof sm !== 'object') return 0;
	return num((sm as UnknownRecord)[key]) ?? 0;
}

function planningMs(p: UnknownRecord): number {
	const a = num(p.planning_initial_ms) ?? 0;
	const b = num(p.planning_post_extraction_ms) ?? 0;
	const c = num(p.planning_post_relations_ms) ?? 0;
	return a + b + c;
}

function sumStageMs(p: UnknownRecord): number {
	let s = 0;
	for (const k of STAGE_KEYS) s += stageMsFromPayload(p, k);
	return s;
}

function sumAttributed(p: UnknownRecord): number {
	return sumStageMs(p) + planningMs(p);
}

function timingTelemetryFromEnvelope(env: UnknownRecord | null | undefined): UnknownRecord | null {
	if (!env || typeof env !== 'object') return null;
	const tt = env.timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return null;
	const tto = tt as UnknownRecord;
	if (!tto.stage_ms || typeof tto.stage_ms !== 'object') return null;
	return tto;
}

function percentile(sorted: number[], p: number): number {
	const n = sorted.length;
	if (n === 0) return NaN;
	const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)));
	return sorted[idx]!;
}

function mean(xs: number[]): number {
	if (xs.length === 0) return NaN;
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function msBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
	if (!a || !b) return null;
	const d = b.getTime() - a.getTime();
	return Number.isFinite(d) && d >= 0 ? d : null;
}

async function main(): Promise<void> {
	loadServerEnv();
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}
	const db = getDrizzleDb();

	const runs = await db
		.select({
			id: ingestRuns.id,
			createdAt: ingestRuns.createdAt,
			completedAt: ingestRuns.completedAt,
			reportEnvelope: ingestRuns.reportEnvelope
		})
		.from(ingestRuns)
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.createdAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`
			)
		);

	const logRows = await db
		.select({
			runId: ingestRunLogs.runId,
			seq: ingestRunLogs.seq,
			line: ingestRunLogs.line
		})
		.from(ingestRunLogs)
		.innerJoin(ingestRuns, eq(ingestRunLogs.runId, ingestRuns.id))
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`,
				sql`position('[INGEST_TIMING]' in ${ingestRunLogs.line}) > 0`
			)
		)
		.orderBy(asc(ingestRunLogs.runId), asc(ingestRunLogs.seq));

	const linesByRun = new Map<string, string[]>();
	for (const r of logRows) {
		const arr = linesByRun.get(r.runId) ?? [];
		arr.push(r.line);
		linesByRun.set(r.runId, arr);
	}

	type Row = {
		id: string;
		e2eDbMs: number | null;
		totalTruth: number | null;
		/** Payload that supplied `stage_ms` + planning (envelope timingTelemetry preferred over log). */
		attrPayload: UnknownRecord | null;
		sumAttr: number;
		source: 'envelope' | 'log' | 'none';
	};

	const rows: Row[] = [];
	for (const r of runs) {
		const env = r.reportEnvelope as UnknownRecord | null;
		const envTt = timingTelemetryFromEnvelope(env);
		const logP = parseLastTimingPayload(linesByRun.get(r.id) ?? []);

		let attrPayload: UnknownRecord | null = null;
		let source: Row['source'] = 'none';
		if (envTt) {
			attrPayload = envTt;
			source = 'envelope';
		} else if (logP && logP.stage_ms && typeof logP.stage_ms === 'object') {
			attrPayload = logP;
			source = 'log';
		}

		const sumAttr = attrPayload ? sumAttributed(attrPayload) : 0;

		const envTotal = envTt ? num(envTt.total_wall_ms) : null;
		const logTotal = logP ? num(logP.total_wall_ms) : null;
		const totalTruth =
			envTotal !== null && envTotal > 0
				? envTotal
				: logTotal !== null && logTotal > 0
					? logTotal
					: null;

		rows.push({
			id: r.id,
			e2eDbMs: msBetween(r.createdAt, r.completedAt),
			totalTruth,
			attrPayload,
			sumAttr,
			source
		});
	}

	const withTruth = rows.filter((x) => x.totalTruth !== null && x.totalTruth > 0);
	const withAttr = rows.filter((x) => x.sumAttr > 0);
	const attrNoTruth = withAttr.filter((x) => x.totalTruth === null || x.totalTruth <= 0);

	const fracTruth = withTruth.map((x) => stageMsFromPayload(x.attrPayload ?? {}, 'extracting') / x.totalTruth!);
	const fracAttr = withAttr.map(
		(x) => stageMsFromPayload(x.attrPayload ?? {}, 'extracting') / x.sumAttr
	);
	const fracAttrNoTruth = attrNoTruth.map(
		(x) => stageMsFromPayload(x.attrPayload ?? {}, 'extracting') / x.sumAttr
	);

	const both = withTruth.filter((x) => x.sumAttr > 0);
	const ratioSumOverTotal = both.map((x) => x.sumAttr / x.totalTruth!);
	const biasFrac = both.map((x) => {
		const ext = stageMsFromPayload(x.attrPayload ?? {}, 'extracting');
		return ext / x.sumAttr - ext / x.totalTruth!;
	});

	const pooledFracExtract = rows
		.filter((x) => x.sumAttr > 0)
		.map((x) => {
			const ext = stageMsFromPayload(x.attrPayload ?? {}, 'extracting');
			if (x.totalTruth !== null && x.totalTruth > 0) return ext / x.totalTruth;
			return ext / x.sumAttr;
		});

	const e2eOnly = rows.filter((x) => x.sumAttr <= 0 && x.e2eDbMs !== null);
	const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 0.5);
	const poolMean = mean(pooledFracExtract.filter((f) => Number.isFinite(f)));
	const poolP50 = percentile([...pooledFracExtract].sort((a, b) => a - b), 0.5);
	const poolP90 = percentile([...pooledFracExtract].sort((a, b) => a - b), 0.9);

	const truthMeanFrac = fracTruth.length ? mean(fracTruth) : NaN;
	const estExtractMsPooled = e2eOnly.map((x) => (x.e2eDbMs ?? 0) * poolMean);
	const estExtractMsTruthMean = e2eOnly.map((x) => (x.e2eDbMs ?? 0) * (Number.isFinite(truthMeanFrac) ? truthMeanFrac : poolMean));
	const sortedEstP = [...estExtractMsPooled].sort((a, b) => a - b);
	const sortedEstT = [...estExtractMsTruthMean].sort((a, b) => a - b);

	console.log(`── Phase 0 extrapolation (Neon, last ${days}d, done, not cancelled) ──`);
	console.log(`completed runs (DB E2E known):     ${runs.length}`);
	console.log(`runs with INGEST_TIMING log lines: ${linesByRun.size}`);
	console.log('');
	console.log('── Cohorts ──');
	console.log(`truth total_wall_ms (>0):        ${withTruth.length}`);
	console.log(`attributed sum > 0 (env or log):   ${withAttr.length}`);
	console.log(`  … envelope stage_ms:           ${withAttr.filter((x) => x.source === 'envelope').length}`);
	console.log(`  … log-only stage_ms:           ${withAttr.filter((x) => x.source === 'log').length}`);
	console.log(`attributed but no truth:         ${attrNoTruth.length}`);
	console.log(`DB E2E only (no stage_ms):       ${e2eOnly.length}`);
	console.log('');

	console.log('── Fraction extracting / total_wall_ms (truth cohort) ──');
	if (fracTruth.length > 0) {
		const s = [...fracTruth].sort((a, b) => a - b);
		console.log(`  n=${fracTruth.length}  mean=${mean(fracTruth).toFixed(4)}  p50=${percentile(s, 0.5).toFixed(4)}  p90=${percentile(s, 0.9).toFixed(4)}`);
	} else {
		console.log('  (none)');
	}
	console.log('');

	console.log('── Fraction extracting / sum(attributed) — all runs with sum > 0 ──');
	if (fracAttr.length > 0) {
		const s = [...fracAttr].sort((a, b) => a - b);
		console.log(`  n=${fracAttr.length}  mean=${mean(fracAttr).toFixed(4)}  p50=${percentile(s, 0.5).toFixed(4)}  p90=${percentile(s, 0.9).toFixed(4)}`);
	}
	console.log('── Same, attributed rows WITHOUT truth total_wall_ms ──');
	if (fracAttrNoTruth.length > 0) {
		const s = [...fracAttrNoTruth].sort((a, b) => a - b);
		console.log(
			`  n=${fracAttrNoTruth.length}  mean=${mean(fracAttrNoTruth).toFixed(4)}  p50=${percentile(s, 0.5).toFixed(4)}  p90=${percentile(s, 0.9).toFixed(4)}`
		);
	} else {
		console.log('  (none)');
	}
	console.log('');

	console.log('── Calibration (runs with BOTH truth total and sum attributed) ──');
	if (both.length > 0) {
		const rs = [...ratioSumOverTotal].sort((a, b) => a - b);
		const bs = [...biasFrac].sort((a, b) => a - b);
		console.log(`  n=${both.length}`);
		console.log(`  sum(attr)/total_wall_ms:  mean=${mean(ratioSumOverTotal).toFixed(4)}  p50=${percentile(rs, 0.5).toFixed(4)}  p90=${percentile(rs, 0.9).toFixed(4)}`);
		console.log(
			`  bias (ext/sum - ext/total): mean=${mean(biasFrac).toFixed(4)}  p50=${percentile(bs, 0.5).toFixed(4)}  (positive ⇒ attributed denominator smaller than E2E)`
		);
		const sumsTruth = both.map((x) => x.sumAttr);
		const totals = both.map((x) => x.totalTruth!);
		console.log(
			`  sum(attr) ms:  median=${Math.round(median(sumsTruth))}  |  total_wall ms: median=${Math.round(median(totals))}`
		);
	} else {
		console.log('  (none)');
	}
	console.log('');
	console.log('── Diagnostics: sum(attr) when total_wall_ms missing vs truth cohort ──');
	if (attrNoTruth.length > 0) {
		const s0 = attrNoTruth.map((x) => x.sumAttr);
		const e2e = attrNoTruth.map((x) => x.e2eDbMs).filter((v): v is number => v != null);
		console.log(
			`  no-truth (n=${attrNoTruth.length}) sum(attr) median=${Math.round(median(s0))} ms; DB E2E median=${e2e.length ? Math.round(median(e2e)) : 'n/a'} ms`
		);
		console.log(
			`  ⇒ if sum(attr) << DB E2E, ext/sum overstates share of extracting vs true E2E. Prefer truth fractions for gates.`
		);
	}
	console.log('');

	console.log('── Pooled fraction (truth uses /total; else /sum) — for crude scaling ──');
	if (pooledFracExtract.length > 0) {
		const s = [...pooledFracExtract].sort((a, b) => a - b);
		console.log(`  n=${pooledFracExtract.length}  mean=${mean(pooledFracExtract).toFixed(4)}  p50=${percentile(s, 0.5).toFixed(4)}  p90=${percentile(s, 0.9).toFixed(4)}`);
	}
	console.log('');

	console.log('── Estimated extracting wall (ms) = DB_E2E × fraction (runs with no stage_ms) ──');
	console.log(`  runs scaled: ${e2eOnly.length}`);
	if (e2eOnly.length > 0) {
		const e2eSorted = e2eOnly.map((x) => x.e2eDbMs!).sort((a, b) => a - b);
		console.log(
			`  DB E2E ms (same runs): p50=${Math.round(percentile(e2eSorted, 0.5))}  p90=${Math.round(percentile(e2eSorted, 0.9))}  mean=${Math.round(mean(e2eOnly.map((x) => x.e2eDbMs!)))}`
		);
		console.log(
			`  × pooled mean frac (${poolMean.toFixed(4)}): extract p50=${Math.round(percentile(sortedEstP, 0.5))}  p90=${Math.round(percentile(sortedEstP, 0.9))}  mean=${Math.round(mean(estExtractMsPooled))}`
		);
		if (Number.isFinite(truthMeanFrac)) {
			console.log(
				`  × truth-only mean frac (${truthMeanFrac.toFixed(4)}): extract p50=${Math.round(percentile(sortedEstT, 0.5))}  p90=${Math.round(percentile(sortedEstT, 0.9))}  mean=${Math.round(mean(estExtractMsTruthMean))}  (preferred for magnitude)`
			);
		}
	}
	console.log('');
	console.log(
		'Caveats: for rows without `total_wall_ms`, ext/sum(attributed) can overstate extracting share if `sum(stage_ms)` understates real wall (see diagnostics). Pooled mean mixes denominators; prefer **truth mean** to scale DB E2E when stage_ms is absent.'
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
