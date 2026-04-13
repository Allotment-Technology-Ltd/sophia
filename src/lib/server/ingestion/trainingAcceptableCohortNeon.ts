/**
 * Shared Neon queries for **training-acceptable** ingest cohorts (governance + envelope lineage rules).
 * Used by admin URL presets and `scripts/aggregate-phase0-baseline-training-cohort-neon.ts`.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import { ingestRuns, sourceTrainingGovernance } from '../db/schema';
import { isNeonIngestPersistenceEnabled } from '../neon/datastore';
import { canonicalizeAndHashSourceUrl } from '../sourceIdentity';
import { isTrainingModuleAcceptableLineage } from './trainingAcceptableLineagePolicy';

export async function loadGovernanceExcludedByHash(): Promise<Map<string, boolean>> {
	const db = getDrizzleDb();
	const govRows = await db.select().from(sourceTrainingGovernance);
	const governanceExcludedByHash = new Map<string, boolean>();
	for (const r of govRows) {
		governanceExcludedByHash.set(r.canonicalUrlHash, r.excludeFromModelTraining === true);
	}
	return governanceExcludedByHash;
}

export type DoneIngestRunsQueryOpts = {
	/**
	 * When true (default), require `reportEnvelope.timingTelemetry.stage_ms` — matches Phase 0 cost aggregate
	 * (`scripts/aggregate-phase0-baseline-training-cohort-neon.ts`). When false, any completed run with a
	 * non-null `reportEnvelope` is eligible; `listTrainingAcceptableUrlsFromNeon` then applies
	 * `isTrainingModuleAcceptableLineage` so the preset aligns with dataset coverage “training acceptable” counts
	 * (which only need `timingTelemetry.stage_models`, not `stage_ms`).
	 */
	requireStageMsTelemetry?: boolean;
};

/** Completed runs in the time window (optional `stage_ms` filter for cost telemetry vs cohort URL lists). */
export async function queryDoneIngestRunsWithStageMsTelemetry(
	days: number,
	opts?: DoneIngestRunsQueryOpts
): Promise<(typeof ingestRuns.$inferSelect)[]> {
	const db = getDrizzleDb();
	const capDays = Math.min(730, Math.max(1, Math.trunc(days) || 90));
	const requireMs = opts?.requireStageMsTelemetry !== false;
	const stagePredicates = requireMs
		? [
				sql`${ingestRuns.reportEnvelope} ? 'timingTelemetry'`,
				sql`${ingestRuns.reportEnvelope}->'timingTelemetry' ? 'stage_ms'`
			]
		: [isNotNull(ingestRuns.reportEnvelope)];
	return db
		.select()
		.from(ingestRuns)
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				isNotNull(ingestRuns.completedAt),
				sql`${ingestRuns.completedAt} >= now() - (${capDays}::int) * interval '1 day'`,
				...stagePredicates
			)
		)
		.orderBy(desc(ingestRuns.completedAt));
}

export type TrainingAcceptableUrlRow = {
	url: string;
	sourceType: string;
	runId: string;
	completedAt: string | null;
	validate: boolean;
	trainingAcceptable: true;
};

export async function listTrainingAcceptableUrlsFromNeon(opts: {
	days: number;
	limit?: number;
	validateOnly?: boolean;
}): Promise<{ urls: TrainingAcceptableUrlRow[]; cohortMeta: { days: number; scannedRunCount: number } }> {
	if (!isNeonIngestPersistenceEnabled()) {
		const d = Math.min(730, Math.max(1, Math.trunc(opts.days) || 90));
		return { urls: [], cohortMeta: { days: d, scannedRunCount: 0 } };
	}
	const limit = Math.max(1, Math.min(5000, opts.limit ?? 500));
	const capDays = Math.min(730, Math.max(1, Math.trunc(opts.days) || 90));
	const runs = await queryDoneIngestRunsWithStageMsTelemetry(capDays, {
		requireStageMsTelemetry: false
	});
	const governanceExcludedByHash = await loadGovernanceExcludedByHash();
	const urls: TrainingAcceptableUrlRow[] = [];
	let scannedRunCount = 0;
	for (const ir of runs) {
		scannedRunCount++;
		const env =
			ir.reportEnvelope && typeof ir.reportEnvelope === 'object' && !Array.isArray(ir.reportEnvelope)
				? (ir.reportEnvelope as Record<string, unknown>)
				: null;
		const identity = canonicalizeAndHashSourceUrl(ir.sourceUrl);
		const hash = identity?.canonicalUrlHash ?? '';
		const govEx = hash ? (governanceExcludedByHash.get(hash) ?? false) : false;
		if (!isTrainingModuleAcceptableLineage(govEx, env)) continue;
		const payload =
			ir.payload && typeof ir.payload === 'object' && !Array.isArray(ir.payload)
				? (ir.payload as Record<string, unknown>)
				: {};
		const validate = payload.validate === true;
		if (opts.validateOnly && !validate) continue;
		urls.push({
			url: ir.sourceUrl,
			sourceType: ir.sourceType,
			runId: ir.id,
			completedAt: ir.completedAt?.toISOString() ?? null,
			validate,
			trainingAcceptable: true
		});
		if (urls.length >= limit) break;
	}
	return { urls, cohortMeta: { days: capDays, scannedRunCount } };
}

export function cohortFingerprintFromUrlList(urls: string[]): string {
	const lines = urls.map((u) => u.trim().toLowerCase()).filter(Boolean).sort();
	return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}
