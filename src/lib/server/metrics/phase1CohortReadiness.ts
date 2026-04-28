/**
 * Reference cohort gate: golden URLs + recent validate-on Neon cohort vs latest completed ingest telemetry
 * (`ingest_runs.report_envelope` merged in inquiry corpus / dataset coverage).
 */

import { canonicalizeSourceUrl } from '$lib/server/sourceIdentity';

export type Phase1CohortSlice = {
	uniqueUrls: number;
	/** Appears in completed-source map (Neon done, job done, or Surreal complete merge). */
	withAnyCompletedIngest: number;
	/** Full validate → remediate → embed → Surreal store path on latest envelope (see note). */
	phase2ReadyCount: number;
	missingFromCorpus: number;
	notValidatePath: number;
	incompletePipeline: number;
	skippedSurrealStore: number;
	/** Up to 15 URLs still not phase2-ready (for operators). */
	sampleNotReady: string[];
};

export type Phase1ReadinessBlock = {
	goldenFingerprint: string;
	trainingCohortDays: number;
	trainingCohortValidateOnly: boolean;
	trainingUrlCap: number;
	golden: Phase1CohortSlice;
	training: Phase1CohortSlice;
	union: Phase1CohortSlice;
	/** True when every URL in the golden ∪ reference validate union is answer-ready (full pipeline telemetry). */
	allUnionUrlsPhase2Ready: boolean;
	note: string;
};

export type Phase1CoverageRow = {
	canonicalUrl: string;
	sourceType: string;
	envelope: Record<string, unknown> | null;
	/** Present when this URL’s latest complete row came from Neon `ingest_runs` (staging keyed by run id). */
	neonRunId?: string | null;
};

type CoverageRow = Phase1CoverageRow;

type ReadinessClass = 'ready' | 'missing' | 'no_validate' | 'incomplete' | 'skipped_store';

function coerceFiniteNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

function readStageMs(envelope: Record<string, unknown>): Record<string, number> {
	const tt = envelope.timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return {};
	const sm = (tt as Record<string, unknown>).stage_ms;
	if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return {};
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(sm)) {
		const n = coerceFiniteNumber(v);
		if (n !== null) out[k] = n;
	}
	return out;
}

/**
 * Latest merged row is "Phase 2 handoff ready" when a validate=true run finished embedding + Surreal store
 * with remediation accounted for in timing. See `note` on `Phase1ReadinessBlock` for edge cases.
 */
export function classifyPhase1UrlReadiness(envelope: Record<string, unknown> | null | undefined): ReadinessClass {
	if (!envelope) return 'incomplete';
	if (envelope.validate !== true) return 'no_validate';

	const tt = envelope.timingTelemetry as Record<string, unknown> | undefined;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return 'incomplete';

	if (tt.skipped_surreal_store_no_graph_changes === true) return 'skipped_store';

	const stages = readStageMs(envelope);
	if ((stages.validating ?? 0) <= 0) return 'incomplete';

	const embedWall = coerceFiniteNumber(tt.embed_wall_ms) ?? 0;
	const embedded = (stages.embedding ?? 0) > 0 || embedWall > 0;
	if (!embedded) return 'incomplete';

	const storeWall = coerceFiniteNumber(tt.store_wall_ms) ?? 0;
	const stored = (stages.storing ?? 0) > 0 || storeWall > 0;
	if (!stored) return 'incomplete';

	return 'ready';
}

function emptySlice(): Phase1CohortSlice {
	return {
		uniqueUrls: 0,
		withAnyCompletedIngest: 0,
		phase2ReadyCount: 0,
		missingFromCorpus: 0,
		notValidatePath: 0,
		incompletePipeline: 0,
		skippedSurrealStore: 0,
		sampleNotReady: []
	};
}

function summarizeUrlsAgainstCorpus(
	rawUrls: string[],
	byCanonical: Map<string, CoverageRow>,
	opts?: { sampleCap?: number }
): Phase1CohortSlice {
	const cap = opts?.sampleCap ?? 15;
	const out = emptySlice();
	const seen = new Set<string>();
	const samples: string[] = [];

	const pushSample = (url: string) => {
		if (samples.length >= cap) return;
		samples.push(url);
	};

	for (const raw of rawUrls) {
		const c = canonicalizeSourceUrl(raw.trim());
		if (!c) continue;
		if (seen.has(c)) continue;
		seen.add(c);
		out.uniqueUrls += 1;

		const row = byCanonical.get(c);
		if (!row) {
			out.missingFromCorpus += 1;
			pushSample(raw.trim());
			continue;
		}
		out.withAnyCompletedIngest += 1;

		const cls = classifyPhase1UrlReadiness(row.envelope);
		if (cls === 'ready') {
			out.phase2ReadyCount += 1;
			continue;
		}
		if (cls === 'missing') {
			out.missingFromCorpus += 1;
			pushSample(raw.trim());
			continue;
		}
		if (cls === 'no_validate') {
			out.notValidatePath += 1;
			pushSample(raw.trim());
			continue;
		}
		if (cls === 'skipped_store') {
			out.skippedSurrealStore += 1;
			pushSample(raw.trim());
			continue;
		}
		out.incompletePipeline += 1;
		pushSample(raw.trim());
	}

	out.sampleNotReady = samples;
	return out;
}

function unionUrls(a: string[], b: string[]): string[] {
	const byKey = new Map<string, string>();
	for (const list of [a, b]) {
		for (const raw of list) {
			const t = raw.trim();
			if (!t) continue;
			const k = canonicalizeSourceUrl(t);
			if (!k) continue;
			if (!byKey.has(k)) byKey.set(k, t);
		}
	}
	return [...byKey.values()];
}

export function buildPhase1ReadinessBlock(params: {
	byCanonical: Map<string, Phase1CoverageRow>;
	goldenUrls: string[];
	trainingUrls: string[];
	goldenFingerprint: string;
	trainingCohortDays: number;
	trainingCohortValidateOnly: boolean;
	trainingUrlCap: number;
}): Phase1ReadinessBlock {
	const golden = summarizeUrlsAgainstCorpus(params.goldenUrls, params.byCanonical);
	const training = summarizeUrlsAgainstCorpus(params.trainingUrls, params.byCanonical);
	const union = summarizeUrlsAgainstCorpus(unionUrls(params.goldenUrls, params.trainingUrls), params.byCanonical);

	const allUnionUrlsPhase2Ready =
		union.uniqueUrls > 0 && union.phase2ReadyCount === union.uniqueUrls && union.skippedSurrealStore === 0;

	const note =
		'For philosophical Q&A, a source should be retrievable end-to-end: latest deduped complete row must show `validate: true`, ' +
		'`timingTelemetry.stage_ms.validating` > 0, non-zero embedding (stage_ms.embedding or embed_wall_ms), ' +
		'and non-zero Surreal store (stage_ms.storing or store_wall_ms) so vectors and graph both exist. ' +
		'`remediating` in timing is optional when Stage 5b did not run or older workers omitted the key. ' +
		'Runs that only skipped Surreal via `skipped_surreal_store_no_graph_changes` count as **not** graph-backed for this check.';

	return {
		goldenFingerprint: params.goldenFingerprint,
		trainingCohortDays: params.trainingCohortDays,
		trainingCohortValidateOnly: params.trainingCohortValidateOnly,
		trainingUrlCap: params.trainingUrlCap,
		golden,
		training,
		union,
		allUnionUrlsPhase2Ready,
		note
	};
}
