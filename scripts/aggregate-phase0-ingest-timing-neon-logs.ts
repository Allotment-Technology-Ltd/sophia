/**
 * Phase 0 — aggregate `[INGEST_TIMING]` JSON from Neon `ingest_run_logs` (last line per run).
 * Same payload shape as `report_envelope.timingTelemetry` / GCP stdout.
 *
 *   pnpm ops:phase0-timing-from-neon-logs
 *   pnpm exec tsx --env-file=.env scripts/aggregate-phase0-ingest-timing-neon-logs.ts -- --days=90
 *
 * Requires DATABASE_URL (loadServerEnv: .env then .env.local). Read-only.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRunLogs, ingestRuns } from '../src/lib/server/db/schema.ts';

type UnknownRecord = Record<string, unknown>;

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 730) return 90;
	return n;
}

/** Walk lines newest-first; parse JSON after last `[INGEST_TIMING]` on the line (matches worker noise prefixes). */
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

function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : null;
	}
	return null;
}

function stageMs(p: UnknownRecord, key: string): number {
	const sm = p.stage_ms;
	if (!sm || typeof sm !== 'object') return 0;
	return num((sm as UnknownRecord)[key]) ?? 0;
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

function pearson(a: number[], b: number[]): number | null {
	const n = Math.min(a.length, b.length);
	if (n < 2) return null;
	let sumA = 0;
	let sumB = 0;
	for (let i = 0; i < n; i++) {
		sumA += a[i]!;
		sumB += b[i]!;
	}
	const meanA = sumA / n;
	const meanB = sumB / n;
	let nume = 0;
	let denA = 0;
	let denB = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i]! - meanA;
		const db = b[i]! - meanB;
		nume += da * db;
		denA += da * da;
		denB += db * db;
	}
	const den = Math.sqrt(denA * denB);
	return den === 0 ? null : nume / den;
}

function printStats(label: string, payloads: UnknownRecord[]): void {
	const withTotal = payloads.filter((p) => {
		const t = num(p.total_wall_ms);
		return t !== null && t > 0;
	});

	console.log(`── ${label} ──`);
	console.log(`runs with parsed timing:  ${payloads.length}`);
	console.log(`with total_wall_ms > 0:   ${withTotal.length}`);
	console.log('');

	if (withTotal.length === 0) {
		console.log('No payloads with total_wall_ms > 0.');
		return;
	}

	const fracExtract = withTotal.map((p) => {
		const tw = num(p.total_wall_ms)!;
		return stageMs(p, 'extracting') / tw;
	});
	const sortedFrac = [...fracExtract].sort((a, b) => a - b);

	console.log('Fraction extracting / total_wall_ms:');
	console.log(`  mean:  ${mean(fracExtract).toFixed(4)}  (~${(100 * mean(fracExtract)).toFixed(1)}%)`);
	console.log(`  p50:   ${percentile(sortedFrac, 0.5).toFixed(4)}`);
	console.log(`  p90:   ${percentile(sortedFrac, 0.9).toFixed(4)}  (~${(100 * percentile(sortedFrac, 0.9)).toFixed(1)}% at p90)`);
	console.log('');

	const meanFracValidating = mean(
		withTotal.map((p) => stageMs(p, 'validating') / num(p.total_wall_ms)!)
	);
	const meanFracRemediating = mean(
		withTotal.map((p) => stageMs(p, 'remediating') / num(p.total_wall_ms)!)
	);
	const meanFracStoring = mean(withTotal.map((p) => stageMs(p, 'storing') / num(p.total_wall_ms)!));

	console.log('Mean stage_ms / total_wall_ms:');
	console.log(`  extracting:   ${mean(fracExtract).toFixed(4)}`);
	console.log(`  validating:   ${meanFracValidating.toFixed(4)}`);
	console.log(`  remediating:  ${meanFracRemediating.toFixed(4)}`);
	console.log(`  storing:      ${meanFracStoring.toFixed(4)}`);
	console.log('');

	const withModelWall = withTotal.filter(
		(p) =>
			p.model_call_wall_ms &&
			typeof p.model_call_wall_ms === 'object' &&
			num((p.model_call_wall_ms as UnknownRecord).extraction) != null
	);
	const exMs = withModelWall.map((p) => stageMs(p, 'extracting'));
	const wallMs = withModelWall.map((p) => num((p.model_call_wall_ms as UnknownRecord).extraction)!);
	const c = pearson(exMs, wallMs);
	console.log(
		`corr(extracting_ms, model_call_wall_ms.extraction)  n=${withModelWall.length}${c != null ? `:  ${c.toFixed(3)}` : ''}`
	);

	const withCalls = withModelWall.filter(
		(p) => p.model_calls && typeof p.model_calls === 'object' && num((p.model_calls as UnknownRecord).extraction) != null
	);
	if (withCalls.length > 0) {
		const calls = withCalls.map((p) => num((p.model_calls as UnknownRecord).extraction)!);
		const perCall = withCalls.map((p) => {
			const w = num((p.model_call_wall_ms as UnknownRecord).extraction)!;
			const c0 = Math.max(1, num((p.model_calls as UnknownRecord).extraction)!);
			return w / c0;
		});
		const sortedCalls = [...calls].sort((a, b) => a - b);
		const sortedPerCall = [...perCall].sort((a, b) => a - b);
		console.log(`extraction model_calls:  p50=${percentile(sortedCalls, 0.5)}  p90=${percentile(sortedCalls, 0.9)}`);
		console.log(
			`ms per extraction call:  p50=${Math.round(percentile(sortedPerCall, 0.5))}  p90=${Math.round(percentile(sortedPerCall, 0.9))}`
		);
	}
	console.log('');
}

async function main(): Promise<void> {
	loadServerEnv();
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required (e.g. pnpm exec tsx --env-file=.env scripts/aggregate-phase0-ingest-timing-neon-logs.ts).');
		process.exit(1);
	}

	const db = getDrizzleDb();

	const rows = await db
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

	const byRun = new Map<string, string[]>();
	for (const r of rows) {
		const arr = byRun.get(r.runId) ?? [];
		arr.push(r.line);
		byRun.set(r.runId, arr);
	}

	const logPayloads: UnknownRecord[] = [];
	let parseFailures = 0;
	for (const [, lines] of byRun) {
		const p = parseLastTimingPayload(lines);
		if (p) logPayloads.push(p);
		else parseFailures++;
	}

	const logLinesMatched = rows.length;
	const runsWithTimingLine = byRun.size;

	console.log('── Neon `ingest_run_logs` scan ──');
	console.log(`window:                  last ${days} days (completed_at)`);
	console.log(`log rows (INGEST_TIMING): ${logLinesMatched}`);
	console.log(`distinct runs (any line): ${runsWithTimingLine}`);
	console.log(`runs parsed (last line):  ${logPayloads.length}`);
	console.log(`runs not parsed:          ${parseFailures}`);
	console.log('');

	printStats('Phase 0 stats from log-derived payloads', logPayloads);

	/** Compare `total_wall_ms` from logs vs `report_envelope` for the same runs. */
	const runIds = [...byRun.keys()];
	if (runIds.length === 0) return;

	const envRows = await db
		.select({
			id: ingestRuns.id,
			reportEnvelope: ingestRuns.reportEnvelope
		})
		.from(ingestRuns)
		.where(inArray(ingestRuns.id, runIds));

	const envTotalByRun = new Map<string, number>();
	for (const r of envRows) {
		const env = r.reportEnvelope as UnknownRecord | null;
		const tt = env?.timingTelemetry as UnknownRecord | undefined;
		const tw = tt && num(tt.total_wall_ms);
		if (tw !== null && tw > 0) envTotalByRun.set(r.id, tw);
	}

	const logTotalByRun = new Map<string, number>();
	for (const [rid, lines] of byRun) {
		const p = parseLastTimingPayload(lines);
		const t = p ? num(p.total_wall_ms) : null;
		if (t !== null && t > 0) logTotalByRun.set(rid, t);
	}

	let both = 0;
	let maxAbsDelta = 0;
	for (const id of runIds) {
		const a = logTotalByRun.get(id);
		const b = envTotalByRun.get(id);
		if (a === undefined || b === undefined) continue;
		both++;
		maxAbsDelta = Math.max(maxAbsDelta, Math.abs(a - b));
	}

	console.log('── Log vs `report_envelope.timingTelemetry.total_wall_ms` ──');
	console.log(`runs with log total_wall_ms:     ${logTotalByRun.size}`);
	console.log(`runs with envelope total_wall:   ${envTotalByRun.size}`);
	console.log(`overlap (both present):         ${both}`);
	if (both > 0) {
		console.log(`max |log - envelope| ms (overlap): ${Math.round(maxAbsDelta)}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
