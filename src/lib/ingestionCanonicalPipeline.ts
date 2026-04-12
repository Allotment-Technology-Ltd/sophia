/**
 * Single production ingestion profile: default models per stage and ordered fallbacks
 * when the primary model fails after retries (see scripts/ingest.ts `callStageModel`).
 *
 * Env pins (`INGEST_PIN_*`) still override these defaults for the **first** resolve tier.
 * `scripts/ingest.ts` may still filter cross-tier fallbacks via `INGEST_FINETUNE_LABELER_*` on
 * sensitive stages. Restormel steers the primary route when ingest-provider is `auto` without pins.
 *
 * Vertex Gemini IDs must stay aligned with current Vertex model pages (including preview ids):
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro
 * https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
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
	| 'remediation'
	| 'json_repair';

export type CanonicalModelRef = { provider: ModelProvider; modelId: string };

/**
 * Production profile: **Mistral** for extraction + json_repair (fine-tune lineage defaults),
 * **Vertex Gemini** for relations, grouping, and remediation (capacity + long context on GCP),
 * **Vertex** validation with OpenAI/Vertex fallbacks. OpenAI/Anthropic are not canonical primaries
 * on sensitive stages; allowlist in `ingestionFinetuneLabelerPolicy` enforces defaults at runtime.
 *
 * Extraction uses **mistral-medium-latest** first; long SEP runs often need medium before large.
 */
export const CANONICAL_INGESTION_PRIMARY_MODELS: Record<IngestionLlmStageKey, CanonicalModelRef> = {
	extraction: { provider: 'mistral', modelId: 'mistral-medium-latest' },
	relations: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	grouping: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	/** Distinct from labeler stages: second opinion from another provider improves faithfulness checks. */
	validation: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	remediation: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	json_repair: { provider: 'mistral', modelId: 'mistral-medium-latest' }
};

/**
 * Ordered fallbacks after primary exhausts transient retries (429/5xx/timeout).
 * Relations / grouping / remediation: heavier Vertex then Mistral tiers. Extraction: Mistral sizes.
 */
export const CANONICAL_INGESTION_MODEL_FALLBACKS: Record<IngestionLlmStageKey, CanonicalModelRef[]> = {
	extraction: [
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
	],
	relations: [
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' },
		{ provider: 'mistral', modelId: 'mistral-medium-latest' },
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
	],
	grouping: [
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' },
		{ provider: 'mistral', modelId: 'mistral-medium-latest' },
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
	],
	validation: [
		{ provider: 'openai', modelId: 'gpt-4o' },
		{ provider: 'openai', modelId: 'gpt-4o-mini' },
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' }
	],
	remediation: [
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' },
		{ provider: 'mistral', modelId: 'mistral-medium-latest' },
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
	],
	json_repair: [
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
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
