/**
 * Single production ingestion profile: default models per stage and ordered fallbacks
 * when the primary model fails after retries (see scripts/ingest.ts `callStageModel`).
 *
 * Env pins (`INGEST_PIN_*`) still override these defaults. Restormel may still steer routes
 * when the operator uses ingest-provider `auto` without pins.
 */
import type { ModelProvider } from '@restormel/contracts/providers';

export const INGESTION_PIPELINE_PRESET = 'production' as const;
export type IngestionPipelinePreset = typeof INGESTION_PIPELINE_PRESET;

/** Map legacy stored presets (reports, analytics) to the current single profile. */
export function normalizePipelinePresetForDisplay(
	raw: string | null | undefined
): IngestionPipelinePreset | 'legacy_budget' | 'legacy_balanced' | 'legacy_complexity' | 'unknown' {
	const v = (raw ?? '').trim().toLowerCase();
	if (v === 'production') return INGESTION_PIPELINE_PRESET;
	if (v === 'budget') return 'legacy_budget';
	if (v === 'balanced') return 'legacy_balanced';
	if (v === 'complexity') return 'legacy_complexity';
	return 'unknown';
}

export type IngestionLlmStageKey =
	| 'extraction'
	| 'relations'
	| 'grouping'
	| 'validation'
	| 'json_repair';

export type CanonicalModelRef = { provider: ModelProvider; modelId: string };

/**
 * Primary models tuned for: structured JSON at extract/relate/group, cost-aware validation,
 * fast reliable JSON repair on Vertex (Gemini Flash).
 */
export const CANONICAL_INGESTION_PRIMARY_MODELS: Record<IngestionLlmStageKey, CanonicalModelRef> = {
	extraction: { provider: 'openai', modelId: 'gpt-4o-mini' },
	/** gpt-4o: large context + better TPM headroom than gpt-4-turbo for big claim JSON graphs */
	relations: { provider: 'openai', modelId: 'gpt-4o' },
	grouping: { provider: 'openai', modelId: 'gpt-4o' },
	validation: { provider: 'openai', modelId: 'gpt-4o-mini' },
	json_repair: { provider: 'vertex', modelId: 'gemini-2.5-flash' }
};

/**
 * Ordered fallbacks after primary exhausts transient retries (429/5xx/timeout).
 * Next entries should be stronger or alternate-provider for resilience.
 */
export const CANONICAL_INGESTION_MODEL_FALLBACKS: Record<IngestionLlmStageKey, CanonicalModelRef[]> = {
	extraction: [
		{ provider: 'openai', modelId: 'gpt-4o' },
		{ provider: 'vertex', modelId: 'gemini-2.5-flash' }
	],
	relations: [
		{ provider: 'openai', modelId: 'gpt-4-turbo' },
		{ provider: 'vertex', modelId: 'gemini-2.5-pro' }
	],
	grouping: [
		{ provider: 'openai', modelId: 'gpt-4-turbo' },
		{ provider: 'vertex', modelId: 'gemini-2.5-pro' }
	],
	validation: [
		{ provider: 'openai', modelId: 'gpt-4o' },
		{ provider: 'vertex', modelId: 'gemini-2.5-flash' }
	],
	json_repair: [
		{ provider: 'openai', modelId: 'gpt-4o-mini' },
		{ provider: 'vertex', modelId: 'gemini-2.5-pro' }
	]
};

/** Full chain primary-first for a stage (for ingest worker). */
export function canonicalModelChainForStage(stage: IngestionLlmStageKey): CanonicalModelRef[] {
	const primary = CANONICAL_INGESTION_PRIMARY_MODELS[stage];
	const rest = CANONICAL_INGESTION_MODEL_FALLBACKS[stage] ?? [];
	const out: CanonicalModelRef[] = [primary];
	for (const tier of rest) {
		if (tier.provider === primary.provider && tier.modelId === primary.modelId) continue;
		if (out.some((x) => x.provider === tier.provider && x.modelId === tier.modelId)) continue;
		out.push(tier);
	}
	return out;
}
