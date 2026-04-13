/**
 * Phase 0 baseline aggregates restricted to **training-acceptable** completed ingests
 * (`source_training_governance` + `isTrainingModuleAcceptableLineage` — same rules as
 * `src/lib/server/metrics/datasetTopicPresetCoverage.ts`).
 *
 * Optional second cohort: `payload.validate === true` (LLM validation path ran).
 *
 *   pnpm ops:phase0-baseline-training-cohort -- --days=90
 *   pnpm exec tsx scripts/aggregate-phase0-baseline-training-cohort-neon.ts -- --days=30
 *
 * Requires DATABASE_URL (via `loadServerEnv`: .env / .env.local). Read-only.
 */

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRunIssues, ingestRuns, sourceTrainingGovernance } from '../src/lib/server/db/schema.ts';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.ts';

loadServerEnv();

/** Duplicated from `datasetTopicPresetCoverage.ts` so this script runs under plain `tsx` (no `$lib` alias). */
const TRAINING_LINEAGE_REQUIRED_STAGES = ['extraction', 'relations', 'grouping'] as const;
const TRAINING_LINEAGE_OPTIONAL_STAGES = ['validation', 'remediation', 'json_repair'] as const;
const TRAINING_APPROVED_INFERENCE_PROVIDERS = new Set(['vertex', 'mistral', 'google']);

function parseProviderFromStageModelRef(ref: string): string | null {
	const t = ref.trim().toLowerCase();
	const i = t.indexOf('/');
	if (i <= 0) return null;
	return t.slice(0, i);
}

function readModelChainLabels(envelope: Record<string, unknown>): Record<string, string> | null {
	const raw = envelope.modelChain ?? envelope.model_chain;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v === 'string' && v.trim()) out[k] = v.trim();
	}
	return Object.keys(out).length > 0 ? out : null;
}

function modelChainLabelsImplyBlockedTrainingVendors(envelope: Record<string, unknown>): boolean {
	const chain = readModelChainLabels(envelope);
	if (!chain) return false;
	const blocked =
		/\b(anthropic|openai)\b|\bclaude\b|\bgpt[-_]?(4|3|5)\b|\bgpt-4o\b|\bo[13]-|azure\s*openai/i;
	for (const v of Object.values(chain)) {
		if (blocked.test(v)) return true;
	}
	return false;
}

function trainingLineageTimingVerdict(
	envelope: Record<string, unknown> | null | undefined
): 'ok' | 'blocked' | 'unknown' {
	if (!envelope) return 'unknown';
	const tt = envelope.timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return 'unknown';
	const sm = (tt as { stage_models?: unknown }).stage_models;
	if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return 'unknown';

	for (const st of TRAINING_LINEAGE_REQUIRED_STAGES) {
		const ref = (sm as Record<string, unknown>)[st];
		if (typeof ref !== 'string' || !ref.trim()) return 'unknown';
		const p = parseProviderFromStageModelRef(ref);
		if (!p || !TRAINING_APPROVED_INFERENCE_PROVIDERS.has(p)) return 'blocked';
	}

	for (const st of TRAINING_LINEAGE_OPTIONAL_STAGES) {
		const ref = (sm as Record<string, unknown>)[st];
		if (typeof ref !== 'string' || !ref.trim()) continue;
		const p = parseProviderFromStageModelRef(ref);
		if (!p || !TRAINING_APPROVED_INFERENCE_PROVIDERS.has(p)) return 'blocked';
	}

	return 'ok';
}

function isTrainingModuleAcceptableLineage(
	governanceExcluded: boolean,
	envelope: Record<string, unknown> | null | undefined
): boolean {
	if (governanceExcluded) return false;
	if (!envelope) return false;

	if (envelope.routingStats && typeof envelope.routingStats === 'object') {
		const dr = (envelope.routingStats as { degradedRouteCount?: unknown }).degradedRouteCount;
		if (typeof dr === 'number' && dr > 0) return false;
	}

	const issueSummary =
		envelope.issueSummary && typeof envelope.issueSummary === 'object' && !Array.isArray(envelope.issueSummary)
			? (envelope.issueSummary as Record<string, unknown>)
			: null;
	if (issueSummary) {
		if (typeof issueSummary.recovery_agent === 'number' && issueSummary.recovery_agent > 0) return false;
		if (typeof issueSummary.circuit_open === 'number' && issueSummary.circuit_open > 0) return false;
	}

	const lineage = trainingLineageTimingVerdict(envelope);
	if (lineage === 'blocked') return false;
	if (lineage === 'ok') return true;

	if (modelChainLabelsImplyBlockedTrainingVendors(envelope)) return false;
	return false;
}

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 730) return 90;
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

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return NaN;
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo]!;
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function mean(xs: number[]): number {
	if (xs.length === 0) return NaN;
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs: number[], ys: number[]): number | null {
	if (xs.length < 2 || xs.length !== ys.length) return null;
	const n = xs.length;
	const mx = mean(xs);
	const my = mean(ys);
	let nume = 0;
	let dx = 0;
	let dy = 0;
	for (let i = 0; i < n; i++) {
		const vx = xs[i]! - mx;
		const vy = ys[i]! - my;
		nume += vx * vy;
		dx += vx * vx;
		dy += vy * vy;
	}
	const den = Math.sqrt(dx * dy);
	return den === 0 ? null : nume / den;
}

type TimingRow = {
	id: string;
	sourceUrl: string;
	sourceType: string;
	payload: Record<string, unknown>;
	envelope: Record<string, unknown>;
	validateOn: boolean;
	trainingAcceptable: boolean;
	extractingMs: number;
	totalWallMs: number | null;
	fracExtract: number | null;
	extractionCalls: number | null;
	extractionCallWallMs: number | null;
	batchSplits: number;
	jsonRepairInv: number;
	modelRetries: number;
	recoveryAgentInv: number;
};

function projectTiming(ir: (typeof ingestRuns)['$inferSelect']): TimingRow | null {
	const env =
		ir.reportEnvelope && typeof ir.reportEnvelope === 'object' && !Array.isArray(ir.reportEnvelope)
			? (ir.reportEnvelope as Record<string, unknown>)
			: null;
	if (!env) return null;
	const tt = env.timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return null;
	const tto = tt as Record<string, unknown>;
	const stageMs = tto.stage_ms;
	if (!stageMs || typeof stageMs !== 'object' || Array.isArray(stageMs)) return null;

	const sm = stageMs as Record<string, unknown>;
	const extractingMs = num(sm.extracting);

	const totalRaw = tto.total_wall_ms;
	const totalWallMs =
		totalRaw === null || totalRaw === undefined ? null : num(totalRaw) === 0 ? null : num(totalRaw);

	const mc = tto.model_calls;
	const mwall = tto.model_call_wall_ms;
	let extractionCalls: number | null = null;
	let extractionCallWallMs: number | null = null;
	if (mc && typeof mc === 'object' && !Array.isArray(mc)) {
		const v = (mc as Record<string, unknown>).extraction;
		if (typeof v === 'number' && Number.isFinite(v)) extractionCalls = v;
		else if (typeof v === 'string' && v.trim()) {
			const n = parseInt(v, 10);
			if (Number.isFinite(n)) extractionCalls = n;
		}
	}
	if (mwall && typeof mwall === 'object' && !Array.isArray(mwall)) {
		extractionCallWallMs = num((mwall as Record<string, unknown>).extraction);
	}

	const payload =
		ir.payload && typeof ir.payload === 'object' && !Array.isArray(ir.payload)
			? (ir.payload as Record<string, unknown>)
			: {};
	const validateOn = payload.validate === true;

	return {
		id: ir.id,
		sourceUrl: ir.sourceUrl,
		sourceType: ir.sourceType,
		payload,
		envelope: env,
		validateOn,
		trainingAcceptable: false,
		extractingMs,
		totalWallMs,
		fracExtract: totalWallMs && totalWallMs > 0 ? extractingMs / totalWallMs : null,
		extractionCalls,
		extractionCallWallMs,
		batchSplits: num(tto.batch_splits),
		jsonRepairInv: num(tto.json_repair_invocations),
		modelRetries: num(tto.model_retries),
		recoveryAgentInv: num(tto.recovery_agent_invocations)
	};
}

function statsFor(rows: TimingRow[], key: keyof Pick<TimingRow, 'extractingMs'>): Record<string, number> {
	const vals = rows.map((r) => r[key] as number).sort((a, b) => a - b);
	return {
		p50: percentile(vals, 0.5),
		p90: percentile(vals, 0.9),
		max: vals.length ? vals[vals.length - 1]! : NaN,
		mean: mean(vals)
	};
}

async function main() {
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}

	const db = getDrizzleDb();
	const govRows = await db.select().from(sourceTrainingGovernance);
	const governanceExcludedByHash = new Map<string, boolean>();
	for (const r of govRows) {
		governanceExcludedByHash.set(r.canonicalUrlHash, r.excludeFromModelTraining === true);
	}

	const runs = await db
		.select()
		.from(ingestRuns)
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				isNotNull(ingestRuns.completedAt),
				sql`${ingestRuns.completedAt} >= now() - (${days}::int) * interval '1 day'`,
				sql`${ingestRuns.reportEnvelope} ? 'timingTelemetry'`,
				sql`${ingestRuns.reportEnvelope}->'timingTelemetry' ? 'stage_ms'`
			)
		)
		.orderBy(desc(ingestRuns.completedAt));

	const projected: TimingRow[] = [];
	for (const ir of runs) {
		const row = projectTiming(ir);
		if (!row) continue;
		const identity = canonicalizeAndHashSourceUrl(ir.sourceUrl);
		const hash = identity?.canonicalUrlHash ?? '';
		const govEx = hash ? (governanceExcludedByHash.get(hash) ?? false) : false;
		row.trainingAcceptable = isTrainingModuleAcceptableLineage(govEx, row.envelope);
		projected.push(row);
	}

	const training = projected.filter((r) => r.trainingAcceptable);
	const trainingValidated = training.filter((r) => r.validateOn);
	const withWall = training.filter((r) => r.totalWallMs !== null && r.totalWallMs > 0);
	const withWallValidated = trainingValidated.filter((r) => r.totalWallMs !== null && r.totalWallMs > 0);

	const fracs = withWall.map((r) => r.fracExtract!).sort((a, b) => a - b);
	const fracMean = mean(fracs);
	const fracP90 = percentile(fracs, 0.9);

	const withModelWall = training.filter(
		(r) => r.extractionCalls != null && r.extractionCallWallMs != null && r.extractionCalls > 0
	);
	const extMs = withModelWall.map((r) => r.extractingMs);
	const modelWall = withModelWall.map((r) => r.extractionCallWallMs!);
	const corrCalls = pearson(extMs, modelWall);

	const msPerCall = withModelWall.map((r) => r.extractionCallWallMs! / Math.max(1, r.extractionCalls!));
	const callsArr = withModelWall.map((r) => r.extractionCalls!);

	// Stage table (same projection as report §1.2 "f" CTE) for withWall cohort
	function stageAgg(rows: TimingRow[]) {
		const out: Record<string, { p50: number; p90: number; max: number; mean: number }> = {};
		const keys = [
			'extracting',
			'relating',
			'grouping',
			'embedding',
			'validating',
			'remediating',
			'storing'
		] as const;
		for (const k of keys) {
			const vals = rows
				.map((r) => {
					const sm = (r.envelope.timingTelemetry as Record<string, unknown>)?.stage_ms as
						| Record<string, unknown>
						| undefined;
					return num(sm?.[k]);
				})
				.sort((a, b) => a - b);
			out[k] = {
				p50: percentile(vals, 0.5),
				p90: percentile(vals, 0.9),
				max: vals.length ? vals[vals.length - 1]! : NaN,
				mean: mean(vals)
			};
		}
		const planVals = rows
			.map((r) => {
				const tt = r.envelope.timingTelemetry as Record<string, unknown>;
				return (
					num(tt.planning_initial_ms) +
					num(tt.planning_post_extraction_ms) +
					num(tt.planning_post_relations_ms)
				);
			})
			.sort((a, b) => a - b);
		out.planning = {
			p50: percentile(planVals, 0.5),
			p90: percentile(planVals, 0.9),
			max: planVals.length ? planVals[planVals.length - 1]! : NaN,
			mean: mean(planVals)
		};
		return out;
	}

	const stageStats = stageAgg(withWall);

	const bySourceType: Record<string, number> = {};
	for (const r of training) {
		const k = r.sourceType?.trim() || '(empty)';
		bySourceType[k] = (bySourceType[k] ?? 0) + 1;
	}

	// Issues for training-acceptable runs in window
	const trainingIds = training.map((r) => r.id);
	const issueByKind: Record<string, number> = {};
	if (trainingIds.length > 0) {
		const chunks: string[][] = [];
		for (let i = 0; i < trainingIds.length; i += 200) chunks.push(trainingIds.slice(i, i + 200));
		for (const chunk of chunks) {
			const rows = await db
				.select({ kind: ingestRunIssues.kind, n: sql<number>`count(*)::int`.mapWith(Number) })
				.from(ingestRunIssues)
				.where(inArray(ingestRunIssues.runId, chunk))
				.groupBy(ingestRunIssues.kind);
			for (const r of rows) {
				issueByKind[r.kind] = (issueByKind[r.kind] ?? 0) + r.n;
			}
		}
	}

	const repairKinds = ['json_repair', 'retry', 'ingest_retry', 'recovery_agent'] as const;
	const issueRepairTotal = repairKinds.reduce((s, k) => s + (issueByKind[k] ?? 0), 0);

	const out = {
		generatedAt: new Date().toISOString(),
		days,
		cohort: {
			doneWithStageMsTelemetry: projected.length,
			trainingAcceptable: training.length,
			trainingAcceptableWithValidate: trainingValidated.length,
			trainingAcceptableWithTotalWallMs: withWall.length,
			trainingAcceptableValidatedWithTotalWallMs: withWallValidated.length
		},
		extractionFractionOfE2E: {
			n: withWall.length,
			frac_extract_mean: fracMean,
			frac_extract_p90: fracP90,
			mean_pct: 100 * fracMean,
			p90_pct: 100 * fracP90
		},
		stage_ms_wall_cohort: stageStats,
		by_source_type_training_acceptable: bySourceType,
		concentration: {
			n_model_wall_rows: withModelWall.length,
			pearson_extracting_vs_model_call_wall_ms_extraction: corrCalls,
			median_extraction_calls: percentile([...callsArr].sort((a, b) => a - b), 0.5),
			p90_extraction_calls: percentile([...callsArr].sort((a, b) => a - b), 0.9),
			median_ms_per_extraction_call: percentile([...msPerCall].sort((a, b) => a - b), 0.5),
			p90_ms_per_extraction_call: percentile([...msPerCall].sort((a, b) => a - b), 0.9)
		},
		timing_counters_training_cohort: {
			batch_splits_p50: percentile(
				training.map((r) => r.batchSplits).sort((a, b) => a - b),
				0.5
			),
			batch_splits_p90: percentile(
				training.map((r) => r.batchSplits).sort((a, b) => a - b),
				0.9
			),
			json_repair_invocations_p50: percentile(
				training.map((r) => r.jsonRepairInv).sort((a, b) => a - b),
				0.5
			),
			json_repair_invocations_p90: percentile(
				training.map((r) => r.jsonRepairInv).sort((a, b) => a - b),
				0.9
			),
			model_retries_p50: percentile(
				training.map((r) => r.modelRetries).sort((a, b) => a - b),
				0.5
			),
			model_retries_p90: percentile(
				training.map((r) => r.modelRetries).sort((a, b) => a - b),
				0.9
			),
			recovery_agent_invocations_p50: percentile(
				training.map((r) => r.recoveryAgentInv).sort((a, b) => a - b),
				0.5
			),
			recovery_agent_invocations_p90: percentile(
				training.map((r) => r.recoveryAgentInv).sort((a, b) => a - b),
				0.9
			)
		},
		ingest_run_issues_training_cohort: issueByKind,
		ingest_run_issues_repair_family_sum: issueRepairTotal,
		note:
			'Training-acceptable = not governance-excluded AND isTrainingModuleAcceptableLineage (verified stage_models providers, no recovery_agent in issueSummary, etc.). ' +
			'Runs without LLM validation (payload.validate !== true) are still counted in the primary training cohort; see cohort.trainingAcceptableWithValidate for the validated subset.'
	};

	console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
