/**
 * Operator metrics: completed ingests vs SEP topic presets (data/sep-topic-presets.json),
 * training governance, and coarse model-lineage signals from Neon `ingest_runs.report_envelope`.
 */

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { query } from '$lib/server/db';
import { getDrizzleDb } from '$lib/server/db/neon';
import { ingestRuns, ingestionJobItems, sourceTrainingGovernance } from '$lib/server/db/schema';
import { inferSourceTypeFromUrl } from '$lib/server/ingestRuns';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { getSepEntryTopicPresetMatches, listSepTopicPresets } from '$lib/server/sepEntryBatchPick';
import { canonicalizeAndHashSourceUrl, canonicalizeSourceUrl } from '$lib/server/sourceIdentity';

export const DATASET_PRESET_COVERAGE_GOAL = 10;

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

/** Stages that must have `timingTelemetry.stage_models` entries for training lineage to be considered verified. */
const TRAINING_LINEAGE_REQUIRED_STAGES = ['extraction', 'relations', 'grouping'] as const;

/** Other LLM stages: when present on the envelope, providers must also be training-approved. */
const TRAINING_LINEAGE_OPTIONAL_STAGES = ['validation', 'remediation', 'json_repair'] as const;

/** Ingest providers approved for model-training corpora (Vertex Gemini, Mistral, Google AI Studio Gemini). */
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

/**
 * Operator / catalog labels (not `provider/model` refs) that imply Anthropic or OpenAI routing.
 * Used only when timing telemetry is missing — conservative block, never a substitute for "verified OK".
 */
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

export type TrainingLineageTimingVerdict = 'ok' | 'blocked' | 'unknown';

/**
 * Uses `timingTelemetry.stage_models` (`provider/model` per stage). Missing or partial telemetry → `unknown`.
 */
export function trainingLineageTimingVerdict(
	envelope: Record<string, unknown> | null | undefined
): TrainingLineageTimingVerdict {
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

/**
 * Training-module friendly: governance, envelope quality signals, and **verified** model lineage.
 * Sources without durable `timingTelemetry.stage_models` (e.g. Surreal-only completes, pre-telemetry ingests,
 * or stripped reports) are **not** counted as training-acceptable — unknown lineage is treated as not usable.
 */
export function isTrainingModuleAcceptableLineage(
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

	// Unknown telemetry: still reject if catalog pins explicitly name blocked vendors.
	if (modelChainLabelsImplyBlockedTrainingVendors(envelope)) return false;
	return false;
}

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
	note: string;
};

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
			note: 'Neon ingest persistence is off (DATABASE_URL). Enable Neon to aggregate completed `ingest_runs` and governance rows.'
		};
	}

	const db = getDrizzleDb();

	const govRows = await db.select().from(sourceTrainingGovernance);
	const governanceExcludedByHash = new Map<string, boolean>();
	for (const r of govRows) {
		governanceExcludedByHash.set(r.canonicalUrlHash, r.excludeFromModelTraining === true);
	}

	type Row = { canonicalUrl: string; sourceType: string; envelope: Record<string, unknown> | null };
	const byCanonical = new Map<string, Row>();

	const runRows = await db
		.select({
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
		byCanonical.set(c, { canonicalUrl: c, sourceType: r.sourceType, envelope: env });
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
		note:
			'Training “acceptable” requires: (1) not excluded in Neon `source_training_governance`; (2) no recovery-agent / circuit-open / degraded-route signals in the latest report envelope; (3) verified LLM lineage — `timingTelemetry.stage_models` must list `vertex`, `mistral`, or `google` for extraction, relations, and grouping (and for validation / remediation / json_repair when those keys are present). Missing or incomplete telemetry (including Surreal-only completes) counts as not usable. If telemetry is missing but `modelChain` / `model_chain` labels explicitly reference Anthropic or OpenAI, the source is rejected.'
	};
}
