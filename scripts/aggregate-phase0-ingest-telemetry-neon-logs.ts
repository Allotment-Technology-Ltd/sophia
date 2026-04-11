/**
 * Phase 0 — aggregate `[INGEST_TELEMETRY]` from Neon `ingest_run_logs` (noisy, larger N than `[INGEST_TIMING]`).
 *
 * Focus: `event: 'phase_timing'` (`phase`, `phase_wall_ms`) and `event: 'model_call_end'` (`stage`, `duration_ms`).
 *
 *   pnpm ops:phase0-telemetry-from-neon-logs
 *   pnpm exec tsx scripts/aggregate-phase0-ingest-telemetry-neon-logs.ts -- --days=90
 *
 * Read-only; requires DATABASE_URL via loadServerEnv.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRunLogs, ingestRuns } from '../src/lib/server/db/schema.ts';
import { parseIngestTelemetryPayloadLine } from '../src/lib/server/ingestion/ingestionTelemetry.ts';

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

/** Stdout prefix match first; else JSON after last `[INGEST_TELEMETRY]` (worker noise before prefix). */
function parseTelemetryLine(line: string): Record<string, unknown> | null {
	const direct = parseIngestTelemetryPayloadLine(line);
	if (direct) return direct;
	const prefix = '[INGEST_TELEMETRY]';
	const idx = line.lastIndexOf(prefix);
	if (idx < 0) return null;
	const rest = line.slice(idx + prefix.length).trim();
	if (!rest.startsWith('{')) return null;
	try {
		const o = JSON.parse(rest) as unknown;
		return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function str(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
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

function printBucket(label: string, durationsMs: number[]): void {
	if (durationsMs.length === 0) {
		console.log(`  ${label}: (no events)`);
		return;
	}
	const s = [...durationsMs].sort((a, b) => a - b);
	const sum = durationsMs.reduce((a, b) => a + b, 0);
	console.log(
		`  ${label}: n=${durationsMs.length}  sum=${Math.round(sum)}ms  mean=${Math.round(mean(durationsMs))}ms  p50=${Math.round(percentile(s, 0.5))}  p90=${Math.round(percentile(s, 0.9))}`
	);
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
				sql`position('[INGEST_TELEMETRY]' in ${ingestRunLogs.line}) > 0`
			)
		)
		.orderBy(asc(ingestRunLogs.runId), asc(ingestRunLogs.seq));

	const runsWithLine = new Set<string>();
	let parseOk = 0;
	let parseFail = 0;

	const eventCounts = new Map<string, number>();

	/** Raw per-event samples (model_call_end is always per-call). */
	const stageCallDurations = new Map<string, number[]>();

	/** phase_timing: some phases emit cumulative wall (e.g. validation); take max per (run, phase). */
	const phasePerRunMax = new Map<string, Map<string, number>>();

	const runsPhase = new Set<string>();
	const runsModelEnd = new Set<string>();

	for (const r of rows) {
		runsWithLine.add(r.runId);
		const payload = parseTelemetryLine(r.line);
		if (!payload) {
			parseFail++;
			continue;
		}
		parseOk++;
		const ev = str(payload.event) ?? '(missing)';
		eventCounts.set(ev, (eventCounts.get(ev) ?? 0) + 1);

		if (ev === 'phase_timing') {
			const phase = str(payload.phase) ?? '(unknown_phase)';
			const ms = num(payload.phase_wall_ms);
			if (ms !== null && ms >= 0) {
				let byPhase = phasePerRunMax.get(r.runId);
				if (!byPhase) {
					byPhase = new Map();
					phasePerRunMax.set(r.runId, byPhase);
				}
				const prev = byPhase.get(phase) ?? -1;
				if (ms > prev) byPhase.set(phase, ms);
				runsPhase.add(r.runId);
			}
		}

		if (ev === 'model_call_end') {
			const stage = str(payload.stage) ?? '(unknown_stage)';
			const ms = num(payload.duration_ms);
			if (ms !== null && ms >= 0) {
				const arr = stageCallDurations.get(stage) ?? [];
				arr.push(ms);
				stageCallDurations.set(stage, arr);
				runsModelEnd.add(r.runId);
			}
		}
	}

	/** One value per run per phase (max cumulative / segment wall). */
	const phaseRunLevel = new Map<string, number[]>();
	for (const [, byPhase] of phasePerRunMax) {
		for (const [phase, ms] of byPhase) {
			const arr = phaseRunLevel.get(phase) ?? [];
			arr.push(ms);
			phaseRunLevel.set(phase, arr);
		}
	}

	console.log(`── Neon \`ingest_run_logs\` — [INGEST_TELEMETRY] (last ${days}d, completed_at) ──`);
	console.log(`log rows (substring match): ${rows.length}`);
	console.log(`distinct runs (any such line): ${runsWithLine.size}`);
	console.log(`lines parsed as JSON:        ${parseOk}`);
	console.log(`lines not parsed:            ${parseFail}`);
	console.log('');

	console.log('── Event type counts (parsed lines only) ──');
	const sortedEvents = [...eventCounts.entries()].sort((a, b) => b[1] - a[1]);
	for (const [k, v] of sortedEvents) {
		console.log(`  ${k}: ${v}`);
	}
	console.log('');

	console.log(`── phase_timing — distinct runs with ≥1 valid event: ${runsPhase.size} ──`);
	console.log(
		'  Per-run max phase_wall_ms by phase (validation lines are cumulative within a run; we take max per run).'
	);
	const phases = [...phaseRunLevel.keys()].sort();
	for (const ph of phases) {
		printBucket(ph, phaseRunLevel.get(ph)!);
	}
	if (phases.length === 0) console.log('  (no phase_timing with phase_wall_ms)');
	console.log('');

	console.log(`── model_call_end — distinct runs with ≥1 valid event: ${runsModelEnd.size} ──`);
	const stages = [...stageCallDurations.keys()].sort();
	for (const st of stages) {
		printBucket(st, stageCallDurations.get(st)!);
	}
	if (stages.length === 0) console.log('  (no model_call_end with duration_ms)');
	console.log('');
	console.log(
		'Note: one run emits many model_call_end lines (retries, sub-calls). Summing durations can exceed wall clock; use distributions and compare to §1.5–§1.6 truth timing.'
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
