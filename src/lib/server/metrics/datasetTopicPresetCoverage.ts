/**
 * Inquiry corpus metrics: completed ingests vs SEP topic bundles (data/sep-topic-presets.json),
 * governance exclusions, and extraction-lineage signals from Neon `ingest_runs.report_envelope`
 * (used to judge grounding-trusted sources for philosophical Q&A).
 */

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { query } from '$lib/server/db';
import { getDrizzleDb } from '$lib/server/db/neon';
import {
	ingestRuns,
	ingestStagingClaims,
	ingestStagingRelations,
	ingestionJobItems,
	sourceTrainingGovernance
} from '$lib/server/db/schema';
import { inferSourceTypeFromUrl } from '$lib/server/ingestRuns';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { goldenExtractionEvalFingerprint, loadGoldenExtractionEval } from '$lib/server/ingestion/goldenExtractionEval';
import {
	isTrainingModuleAcceptableLineage,
	trainingLineageTimingVerdict,
	type TrainingLineageTimingVerdict
} from '$lib/server/ingestion/trainingAcceptableLineagePolicy';
import { listTrainingAcceptableUrlsFromNeon } from '$lib/server/ingestion/trainingAcceptableCohortNeon';
import { getSepEntryTopicPresetMatches, listSepTopicPresets } from '$lib/server/sepEntryBatchPick';
import { canonicalizeAndHashSourceUrl, canonicalizeSourceUrl } from '$lib/server/sourceIdentity';
import { buildPhase1ReadinessBlock, type Phase1CoverageRow, type Phase1ReadinessBlock } from './phase1CohortReadiness';

export const DATASET_PRESET_COVERAGE_GOAL = 10;

/** Rolling window for training-acceptable URLs in the Phase 1 readiness block (matches default preset API). */
const PHASE1_READINESS_TRAINING_DAYS = 90;
const PHASE1_READINESS_TRAINING_LIMIT = 3000;

function hostnameIsArxiv(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return h === 'arxiv.org' || h.endsWith('.arxiv.org');
}

export function originBucketForUrl(url: string, storedSourceType?: string | null): string {
	const inferred = inferSourceTypeFromUrl(url);
	switch (inferred) {
		case 'sep_entry':
			return 'SEP';
		case 'book':
			return 'Gutenberg';
		case 'iep_entry':
			return 'IEP';
		case 'paper': {
			try {
				const host = new URL(url.trim()).hostname;
				if (hostnameIsArxiv(host)) return 'arXiv / paper';
			} catch {
				// non-absolute or malformed URL — do not substring-match on arxiv.org (CodeQL / open redirects)
			}
			return 'Academic paper';
		}
		case 'gutenberg_text':
			return 'Gutenberg';
		default: {
			const st = (storedSourceType ?? '').toLowerCase();
			if (st.includes('sep')) return 'SEP';
			if (st.includes('gutenberg') || st.includes('book')) return 'Gutenberg';
			if (st.includes('iep')) return 'IEP';
			return 'Web / institutional';
		}
	}
}

export { isTrainingModuleAcceptableLineage, trainingLineageTimingVerdict, type TrainingLineageTimingVerdict };

function bump(map: Record<string, number>, key: string, n = 1): void {
	map[key] = (map[key] ?? 0) + n;
}

export type PresetCoverageRow = {
	id: string;
	label: string;
	goal: number;
	ingestedCount: number;
	trainingAcceptableCount: number;
	trainingNotAcceptableCount: number;
	byOrigin: Record<string, number>;
};

/**
 * Neon staging counts scoped to the **same URL dedupe** as this report: latest `ingest_runs` row per canonical URL
 * (by `completed_at` desc). Job-only / Surreal-only completes have no `run_id` and are excluded from staging totals.
 */
export type DatasetStagingSupervisionMetrics = {
	/** Canonical URLs whose winning complete row is a Neon run (staging addressable). */
	neonBackedSourceCount: number;
	/** Rows in `ingest_staging_claims` for those latest Neon runs. */
	dedupedClaimRows: number;
	/**
	 * Sum over latest runs of `COUNT(DISTINCT position_in_source)` among claims — passage slots with ≥1 claim,
	 * not necessarily every extracted passage.
	 */
	dedupedPassageSlotsWithClaims: number;
	/** Rows in `ingest_staging_relations` for those runs (directed edge rows). */
	dedupedRelationRows: number;
	trainingAcceptableNeonBackedSourceCount: number;
	trainingAcceptableDedupedClaimRows: number;
	trainingAcceptableDedupedPassageSlotsWithClaims: number;
	trainingAcceptableDedupedRelationRows: number;
};

export type DatasetTopicPresetCoverageResult = {
	generatedAt: string;
	neonIngestPersistence: boolean;
	surrealIngestionLogMerged: boolean;
	presetGoal: number;
	presets: PresetCoverageRow[];
	totals: {
		uniqueSourcesCompleted: number;
		trainingAcceptableCount: number;
		trainingNotAcceptableCount: number;
		byOrigin: Record<string, number>;
	};
	/** SEP completes whose slug did not match any preset keywords. */
	sepIngestedOutsidePresets: number;
	/** Golden + training cohort progress toward validate / remediate / embed / store (Phase 2 handoff). */
	phase1Readiness: Phase1ReadinessBlock | null;
	/** When `phase1Readiness` is null but Neon is on: why the block was not built (operator-facing). */
	phase1ReadinessError: string | null;
	/** Staging claim / passage-slot / relation scale for latest Neon run per URL; null when Neon persistence is off. */
	stagingSupervision: DatasetStagingSupervisionMetrics | null;
	/** Populated when staging aggregation failed (operator-facing). */
	stagingSupervisionError: string | null;
	note: string;
};

async function aggregateStagingForRunIds(
	db: ReturnType<typeof getDrizzleDb>,
	runIds: string[]
): Promise<Pick<DatasetStagingSupervisionMetrics, 'dedupedClaimRows' | 'dedupedPassageSlotsWithClaims' | 'dedupedRelationRows'>> {
	if (runIds.length === 0) {
		return { dedupedClaimRows: 0, dedupedPassageSlotsWithClaims: 0, dedupedRelationRows: 0 };
	}

	const perRunSlots = await db
		.select({
			runId: ingestStagingClaims.runId,
			slots: sql<number>`count(distinct ${ingestStagingClaims.positionInSource})::int`.mapWith(Number)
		})
		.from(ingestStagingClaims)
		.where(inArray(ingestStagingClaims.runId, runIds))
		.groupBy(ingestStagingClaims.runId);

	const dedupedPassageSlotsWithClaims = perRunSlots.reduce((s, r) => s + (r.slots ?? 0), 0);

	const [claimAgg] = await db
		.select({ n: sql<number>`count(*)::int`.mapWith(Number) })
		.from(ingestStagingClaims)
		.where(inArray(ingestStagingClaims.runId, runIds));

	const [relAgg] = await db
		.select({ n: sql<number>`count(*)::int`.mapWith(Number) })
		.from(ingestStagingRelations)
		.where(inArray(ingestStagingRelations.runId, runIds));

	return {
		dedupedClaimRows: claimAgg?.n ?? 0,
		dedupedPassageSlotsWithClaims,
		dedupedRelationRows: relAgg?.n ?? 0
	};
}

async function loadSurrealCompleteUrls(): Promise<string[]> {
	if (!process.env.SURREAL_URL?.trim()) return [];
	try {
		const rows = await query<Array<{ source_url?: string; canonical_url?: string }>>(
			`SELECT source_url, canonical_url FROM ingestion_log WHERE status = 'complete';`,
			{}
		);
		if (!Array.isArray(rows)) return [];
		const out: string[] = [];
		for (const r of rows) {
			for (const u of [r.source_url, r.canonical_url]) {
				if (typeof u === 'string' && u.trim()) out.push(u.trim());
			}
		}
		return out;
	} catch (e) {
		console.warn('[datasetTopicPresetCoverage] Surreal ingestion_log merge failed:', e);
		return [];
	}
}

export async function fetchDatasetTopicPresetCoverage(): Promise<DatasetTopicPresetCoverageResult> {
	const presetMeta = listSepTopicPresets();
	const presetGoal = DATASET_PRESET_COVERAGE_GOAL;
	const generatedAt = new Date().toISOString();

	if (!isNeonIngestPersistenceEnabled()) {
		return {
			generatedAt,
			neonIngestPersistence: false,
			surrealIngestionLogMerged: false,
			presetGoal,
			presets: presetMeta.map((p) => ({
				id: p.id,
				label: p.label,
				goal: presetGoal,
				ingestedCount: 0,
				trainingAcceptableCount: 0,
				trainingNotAcceptableCount: 0,
				byOrigin: {}
			})),
			totals: {
				uniqueSourcesCompleted: 0,
				trainingAcceptableCount: 0,
				trainingNotAcceptableCount: 0,
				byOrigin: {}
			},
			sepIngestedOutsidePresets: 0,
			phase1Readiness: null,
			phase1ReadinessError:
				'Neon ingest persistence is off (DATABASE_URL). Inquiry corpus metrics need Neon to evaluate the reference validate cohort.',
			stagingSupervision: null,
			stagingSupervisionError: null,
			note: 'Neon ingest persistence is off (DATABASE_URL). Enable Neon to aggregate completed `ingest_runs`, governance, and staging used for philosophical inquiry coverage.'
		};
	}

	const db = getDrizzleDb();

	const govRows = await db.select().from(sourceTrainingGovernance);
	const governanceExcludedByHash = new Map<string, boolean>();
	for (const r of govRows) {
		governanceExcludedByHash.set(r.canonicalUrlHash, r.excludeFromModelTraining === true);
	}

	const byCanonical = new Map<string, Phase1CoverageRow>();

	const runRows = await db
		.select({
			id: ingestRuns.id,
			sourceUrl: ingestRuns.sourceUrl,
			sourceType: ingestRuns.sourceType,
			completedAt: ingestRuns.completedAt,
			reportEnvelope: ingestRuns.reportEnvelope
		})
		.from(ingestRuns)
		.where(and(eq(ingestRuns.status, 'done'), isNotNull(ingestRuns.completedAt)))
		.orderBy(desc(ingestRuns.completedAt));

	for (const r of runRows) {
		const c = canonicalizeSourceUrl(r.sourceUrl);
		if (!c || byCanonical.has(c)) continue;
		const env =
			r.reportEnvelope && typeof r.reportEnvelope === 'object' && !Array.isArray(r.reportEnvelope)
				? (r.reportEnvelope as Record<string, unknown>)
				: null;
		byCanonical.set(c, { canonicalUrl: c, sourceType: r.sourceType, envelope: env, neonRunId: r.id });
	}

	const itemRows = await db
		.select({ url: ingestionJobItems.url, sourceType: ingestionJobItems.sourceType })
		.from(ingestionJobItems)
		.where(eq(ingestionJobItems.status, 'done'));

	for (const r of itemRows) {
		const c = canonicalizeSourceUrl(r.url);
		if (!c || byCanonical.has(c)) continue;
		byCanonical.set(c, { canonicalUrl: c, sourceType: r.sourceType, envelope: null });
	}

	let surrealMerged = false;
	for (const raw of await loadSurrealCompleteUrls()) {
		const c = canonicalizeSourceUrl(raw);
		if (!c || byCanonical.has(c)) continue;
		byCanonical.set(c, {
			canonicalUrl: c,
			sourceType: inferSourceTypeFromUrl(raw),
			envelope: null
		});
		surrealMerged = true;
	}

	const totalsByOrigin: Record<string, number> = {};
	let trainingOk = 0;
	let trainingNot = 0;
	let sepOutside = 0;

	const presetIds = presetMeta.map((p) => p.id);
	const perPreset: Record<string, PresetCoverageRow> = {};
	for (const p of presetMeta) {
		perPreset[p.id] = {
			id: p.id,
			label: p.label,
			goal: presetGoal,
			ingestedCount: 0,
			trainingAcceptableCount: 0,
			trainingNotAcceptableCount: 0,
			byOrigin: {}
		};
	}

	for (const row of byCanonical.values()) {
		const identity = canonicalizeAndHashSourceUrl(row.canonicalUrl);
		const hash = identity?.canonicalUrlHash ?? '';
		const govEx = hash ? (governanceExcludedByHash.get(hash) ?? false) : false;
		const acceptable = isTrainingModuleAcceptableLineage(govEx, row.envelope);
		const origin = originBucketForUrl(row.canonicalUrl, row.sourceType);

		bump(totalsByOrigin, origin);
		if (acceptable) trainingOk += 1;
		else trainingNot += 1;

		const presetsHit = getSepEntryTopicPresetMatches(row.canonicalUrl);
		const isSep = origin === 'SEP';
		if (isSep && presetsHit.length === 0) sepOutside += 1;

		for (const pid of presetIds) {
			if (!presetsHit.includes(pid)) continue;
			const cell = perPreset[pid]!;
			cell.ingestedCount += 1;
			bump(cell.byOrigin, origin);
			if (acceptable) cell.trainingAcceptableCount += 1;
			else cell.trainingNotAcceptableCount += 1;
		}
	}

	let phase1Readiness: Phase1ReadinessBlock | null = null;
	let phase1ReadinessError: string | null = null;
	try {
		const golden = loadGoldenExtractionEval();
		const goldenUrls = golden.items.map((i) => i.url.trim()).filter(Boolean);
		const gFp = goldenExtractionEvalFingerprint(golden.items);
		const { urls: trRows } = await listTrainingAcceptableUrlsFromNeon({
			days: PHASE1_READINESS_TRAINING_DAYS,
			limit: PHASE1_READINESS_TRAINING_LIMIT,
			validateOnly: true
		});
		const trainingUrls = trRows.map((r) => r.url.trim()).filter(Boolean);
		phase1Readiness = buildPhase1ReadinessBlock({
			byCanonical,
			goldenUrls,
			trainingUrls,
			goldenFingerprint: gFp,
			trainingCohortDays: PHASE1_READINESS_TRAINING_DAYS,
			trainingCohortValidateOnly: true,
			trainingUrlCap: PHASE1_READINESS_TRAINING_LIMIT
		});
	} catch (e) {
		phase1ReadinessError = e instanceof Error ? e.message : String(e);
		console.warn('[datasetTopicPresetCoverage] phase1Readiness:', phase1ReadinessError);
	}

	const allNeonRunIds: string[] = [];
	const trainingOkNeonRunIds: string[] = [];
	for (const row of byCanonical.values()) {
		const rid = row.neonRunId?.trim();
		if (!rid) continue;
		allNeonRunIds.push(rid);
		const identity = canonicalizeAndHashSourceUrl(row.canonicalUrl);
		const hash = identity?.canonicalUrlHash ?? '';
		const govEx = hash ? (governanceExcludedByHash.get(hash) ?? false) : false;
		if (isTrainingModuleAcceptableLineage(govEx, row.envelope)) {
			trainingOkNeonRunIds.push(rid);
		}
	}
	const uniqueAllRunIds = [...new Set(allNeonRunIds)];
	const uniqueTrainingOkRunIds = [...new Set(trainingOkNeonRunIds)];

	let stagingSupervision: DatasetStagingSupervisionMetrics | null = null;
	let stagingSupervisionError: string | null = null;
	try {
		const [allAgg, trainAgg] = await Promise.all([
			aggregateStagingForRunIds(db, uniqueAllRunIds),
			aggregateStagingForRunIds(db, uniqueTrainingOkRunIds)
		]);
		stagingSupervision = {
			neonBackedSourceCount: uniqueAllRunIds.length,
			...allAgg,
			trainingAcceptableNeonBackedSourceCount: uniqueTrainingOkRunIds.length,
			trainingAcceptableDedupedClaimRows: trainAgg.dedupedClaimRows,
			trainingAcceptableDedupedPassageSlotsWithClaims: trainAgg.dedupedPassageSlotsWithClaims,
			trainingAcceptableDedupedRelationRows: trainAgg.dedupedRelationRows
		};
	} catch (e) {
		stagingSupervisionError = e instanceof Error ? e.message : String(e);
		console.warn('[datasetTopicPresetCoverage] stagingSupervision:', stagingSupervisionError);
		stagingSupervision = {
			neonBackedSourceCount: uniqueAllRunIds.length,
			dedupedClaimRows: 0,
			dedupedPassageSlotsWithClaims: 0,
			dedupedRelationRows: 0,
			trainingAcceptableNeonBackedSourceCount: uniqueTrainingOkRunIds.length,
			trainingAcceptableDedupedClaimRows: 0,
			trainingAcceptableDedupedPassageSlotsWithClaims: 0,
			trainingAcceptableDedupedRelationRows: 0
		};
	}

	return {
		generatedAt,
		neonIngestPersistence: true,
		surrealIngestionLogMerged: surrealMerged,
		presetGoal,
		presets: presetIds.map((id) => perPreset[id]!),
		totals: {
			uniqueSourcesCompleted: byCanonical.size,
			trainingAcceptableCount: trainingOk,
			trainingNotAcceptableCount: trainingNot,
			byOrigin: totalsByOrigin
		},
		sepIngestedOutsidePresets: sepOutside,
		phase1Readiness,
		phase1ReadinessError,
		stagingSupervision,
		stagingSupervisionError,
		note:
			'Grounding-trusted (safe to emphasize in user-facing Q&A) requires: (1) not excluded in Neon `source_training_governance`; (2) no recovery-agent / circuit-open / degraded-route signals in the latest report envelope; (3) extraction lineage we trust for philosophy text — `timingTelemetry.stage_models` must list `vertex`, `mistral`, or `google` for extraction, relations, and grouping (and for validation / remediation / json_repair when those keys are present). Missing or incomplete telemetry (including Surreal-only completes) is treated as not trusted. If telemetry is missing but `modelChain` / `model_chain` labels explicitly reference Anthropic or OpenAI, the source is rejected from the trusted slice.'
	};
}
