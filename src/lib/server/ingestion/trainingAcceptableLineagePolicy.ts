/**
 * Training-module lineage rules for Neon `ingest_runs.report_envelope` (no `$lib` — safe for plain `tsx` scripts).
 */

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

	if (modelChainLabelsImplyBlockedTrainingVendors(envelope)) return false;
	return false;
}
