/**
 * Neon audit — ingest spend signals from completed runs:
 * - `ingest_staging_meta.cost_usd_snapshot` (ingest.ts estimate total when last checkpointed)
 * - `report_envelope.timingTelemetry`: per-stage input/output tokens, `stage_models`, wall `stage_ms`
 * - `report_envelope.modelChain` (operator-selected extract/relate/group hints)
 *
 * Token → USD re-estimate uses the same helper as `scripts/ingest.ts` (`ingestLlmTokenUsdRates`: Keys
 * catalog plus Vertex Gemini 3 standard text supplement).
 *
 *   pnpm ops:audit-ingest-cost-by-phase-neon
 *   pnpm exec tsx --env-file=.env scripts/audit-ingest-cost-by-phase-neon.ts -- --days=365
 *
 * Read-only; requires DATABASE_URL.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
	estimateIngestLlmUsageUsd,
	INGEST_EMBED_USD_PER_MILLION_CHARS
} from '../src/lib/server/ingestion/ingestLlmTokenUsdRates.ts';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns, ingestStagingMeta } from '../src/lib/server/db/schema.ts';

type UnknownRecord = Record<string, unknown>;

const TOKEN_STAGES = [
	'extraction',
	'relations',
	'grouping',
	'validation',
	'remediation',
	'json_repair'
] as const;

const WALL_STAGES = [
	'extracting',
	'relating',
	'grouping',
	'embedding',
	'validating',
	'remediating',
	'storing'
] as const;

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 365;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 365;
	return n;
}

function num(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : 0;
	}
	return 0;
}

function tokenMap(obj: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
	for (const [k, v] of Object.entries(obj as UnknownRecord)) {
		const n = num(v);
		if (n > 0) out[k] = n;
	}
	return out;
}

function modelIdFromStageModelRef(ref: string): string {
	const t = ref.trim();
	const i = t.indexOf('/');
	return i >= 0 ? t.slice(i + 1).trim() : t;
}

function estimateUsdFromTokens(modelRef: string | undefined, inputTokens: number, outputTokens: number): number {
	const ref = modelRef?.trim() ? modelIdFromStageModelRef(modelRef) : '';
	return estimateIngestLlmUsageUsd(ref || 'unknown', inputTokens, outputTokens);
}

function bump(map: Map<string, number>, key: string, delta: number): void {
	if (delta === 0) return;
	map.set(key, (map.get(key) ?? 0) + delta);
}

function printHist(title: string, map: Map<string, number>): void {
	console.log(`── ${title} ──`);
	const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
	if (rows.length === 0) {
		console.log('  (none)');
		console.log('');
		return;
	}
	let total = 0;
	for (const [, c] of rows) total += c;
	for (const [k, c] of rows) {
		const pct = total > 0 ? ((100 * c) / total).toFixed(1) : '—';
		console.log(`  ${c}\t${pct}%\t${k}`);
	}
	console.log('');
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
			completedAt: ingestRuns.completedAt,
			sourceUrl: ingestRuns.sourceUrl,
			sourceType: ingestRuns.sourceType,
			reportEnvelope: ingestRuns.reportEnvelope,
			costUsdSnapshot: ingestStagingMeta.costUsdSnapshot
		})
		.from(ingestRuns)
		.leftJoin(ingestStagingMeta, eq(ingestStagingMeta.runId, ingestRuns.id))
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`
			)
		);

	let withTiming = 0;
	let withCostSnap = 0;
	let withEnvelope = 0;

	const sumInByStage: Map<string, number> = new Map();
	const sumOutByStage: Map<string, number> = new Map();
	const stageModelHist: Map<string, Map<string, number>> = new Map();
	const chainExtract: Map<string, number> = new Map();
	const chainRelate: Map<string, number> = new Map();
	const chainGroup: Map<string, number> = new Map();

	const sumWallByStage: Map<string, number> = new Map();
	let sumTotalWallMs = 0;
	let runsWithTotalWall = 0;

	let sumSnapshotUsd = 0;
	let sumReestimatedUsd = 0;

	for (const TOKEN_ST of TOKEN_STAGES) {
		stageModelHist.set(TOKEN_ST, new Map());
	}

	for (const r of rows) {
		const env = r.reportEnvelope as UnknownRecord | null | undefined;
		if (env && typeof env === 'object') withEnvelope += 1;
		const tt = env?.timingTelemetry as UnknownRecord | undefined;
		if (!tt || typeof tt !== 'object') continue;
		withTiming += 1;

		const sin = tokenMap(tt.stage_input_tokens);
		const sout = tokenMap(tt.stage_output_tokens);
		const sm = tt.stage_models as UnknownRecord | undefined;

		let runEstUsd = 0;
		for (const st of TOKEN_STAGES) {
			const inn = sin[st] ?? 0;
			const outt = sout[st] ?? 0;
			bump(sumInByStage, st, inn);
			bump(sumOutByStage, st, outt);
			const modelRef =
				sm && typeof sm === 'object' && !Array.isArray(sm) && typeof sm[st] === 'string'
					? (sm[st] as string)
					: '';
			if (modelRef) {
				const h = stageModelHist.get(st)!;
				bump(h, modelRef, 1);
				runEstUsd += estimateUsdFromTokens(modelRef, inn, outt);
			} else {
				runEstUsd += estimateUsdFromTokens(undefined, inn, outt);
			}
		}

		const vChars = num(tt.vertex_embed_chars);
		if (vChars > 0) {
			runEstUsd += (vChars / 1_000_000) * INGEST_EMBED_USD_PER_MILLION_CHARS;
		}

		sumReestimatedUsd += runEstUsd;

		const snap = r.costUsdSnapshot;
		if (typeof snap === 'number' && Number.isFinite(snap) && snap >= 0) {
			withCostSnap += 1;
			sumSnapshotUsd += snap;
		}

		const mc = env?.modelChain as UnknownRecord | undefined;
		if (mc && typeof mc === 'object' && !Array.isArray(mc)) {
			const ex = typeof mc.extract === 'string' ? mc.extract : '';
			const rel = typeof mc.relate === 'string' ? mc.relate : '';
			const grp = typeof mc.group === 'string' ? mc.group : '';
			if (ex) bump(chainExtract, ex, 1);
			if (rel) bump(chainRelate, rel, 1);
			if (grp) bump(chainGroup, grp, 1);
		}

		const stageMs = tt.stage_ms as UnknownRecord | undefined;
		if (stageMs && typeof stageMs === 'object' && !Array.isArray(stageMs)) {
			for (const w of WALL_STAGES) {
				bump(sumWallByStage, w, num(stageMs[w]));
			}
		}
		const tw = num(tt.total_wall_ms);
		if (tw > 0) {
			sumTotalWallMs += tw;
			runsWithTotalWall += 1;
		}
	}

	console.log(`── Neon ingest cost / phase audit (${days}d window, status=done, not cancelled) ──`);
	console.log(`  completed runs (rows):     ${rows.length}`);
	console.log(`  with report_envelope:      ${withEnvelope}`);
	console.log(`  with timingTelemetry:      ${withTiming}`);
	console.log(`  with cost_usd_snapshot:    ${withCostSnap} (ingest_staging_meta join)`);
	console.log('');

	console.log('── Stored cost snapshot (sum of meta.cost_usd_snapshot where set) ──');
	console.log(
		`  Σ snapshot USD:            $${sumSnapshotUsd.toFixed(2)}  (runs counted: ${withCostSnap}; missing = not checkpointed or pre-column)`
	);
	console.log(
		`  Re-estimated from tokens:  $${sumReestimatedUsd.toFixed(2)}  (Keys + Vertex Gemini 3 supplement + $0.025/M chars embed)`
	);
	console.log('');

	const totalIn = [...sumInByStage.values()].reduce((a, b) => a + b, 0);
	const totalOut = [...sumOutByStage.values()].reduce((a, b) => a + b, 0);

	console.log('── LLM tokens by pipeline stage (sum over runs with timingTelemetry) ──');
	console.log(`  total input tokens:   ${totalIn.toLocaleString()}`);
	console.log(`  total output tokens:  ${totalOut.toLocaleString()}`);
	console.log('');
	console.log('  stage            input          output         in+out');
	for (const st of TOKEN_STAGES) {
		const inn = sumInByStage.get(st) ?? 0;
		const outt = sumOutByStage.get(st) ?? 0;
		if (inn === 0 && outt === 0) continue;
		console.log(
			`  ${st.padEnd(14)} ${String(inn).padStart(14)} ${String(outt).padStart(14)} ${String(inn + outt).padStart(14)}`
		);
	}
	console.log('');

	printHist('modelChain.extract (operator hint, runs)', chainExtract);
	printHist('modelChain.relate', chainRelate);
	printHist('modelChain.group', chainGroup);

	for (const st of TOKEN_STAGES) {
		const h = stageModelHist.get(st)!;
		const cnt = [...h.values()].reduce((a, b) => a + b, 0);
		if (cnt === 0) continue;
		printHist(`timingTelemetry.stage_models.${st} (last model recorded for that stage, per run)`, h);
	}

	console.log('── Wall time stage_ms (sum ms; only runs that logged timingTelemetry) ──');
	const wallTotal = [...sumWallByStage.values()].reduce((a, b) => a + b, 0);
	if (wallTotal === 0) {
		console.log('  (no stage_ms in timing payloads)');
	} else {
		for (const w of WALL_STAGES) {
			const ms = sumWallByStage.get(w) ?? 0;
			if (ms === 0) continue;
			console.log(`  ${w.padEnd(14)} ${(ms / 3600000).toFixed(2)} h   (${ms.toLocaleString()} ms)`);
		}
		console.log(`  Σ stage_ms:     ${(wallTotal / 3600000).toFixed(2)} h`);
	}
	if (runsWithTotalWall > 0) {
		console.log(
			`  mean total_wall_ms: ${Math.round(sumTotalWallMs / runsWithTotalWall).toLocaleString()} ms (n=${runsWithTotalWall})`
		);
	}
	console.log('');
	console.log(
		'Note: USD snapshot is the ingest script estimate at last Neon partial save. Token re-estimate matches ingest billing helpers (including Vertex Gemini 3 preview SKUs).'
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
