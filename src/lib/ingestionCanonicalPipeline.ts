/**
 * Single production ingestion profile: default models per stage and ordered fallbacks
 * when the primary model fails after retries (see scripts/ingest.ts `callStageModel`).
 *
 * Env pins (`INGEST_PIN_*`) still override these defaults for the **first** resolve tier.
 * `scripts/ingest.ts` may still filter cross-tier fallbacks via `INGEST_FINETUNE_LABELER_*` on
 * sensitive stages. Restormel steers the primary route when ingest-provider is `auto` without pins.
 *
 * **Durable Neon jobs** force {@link CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL} on each child so the corpus
 * stays on **1024-dim Voyage** embeddings (Vertex text-embedding-005 is 768-dim and must not mix in).
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

/** Stable admin label merged into durable job child runs so embeddings stay Voyage 1024-dim. */
export const CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL = 'voyage__voyage-4-lite';

/** Recorded on `ingestion_jobs.embedding_fingerprint` to match the forced child embedding profile. */
export const CANONICAL_VOYAGE_EMBEDDING_FINGERPRINT = 'voyage:voyage-4-lite:1024d';

/**
 * Production profile: **Vertex Gemini** for extraction, relations, grouping, and remediation
 * (capacity + long context on GCP billing). **Validation** defaults to **Mistral Large** so the first
 * verification pass is never the same route as Vertex Flash extraction (a real second opinion); OpenAI
 * and Vertex tiers follow as fallbacks. **Mistral** is the first fallback on other heavy stages and remains
 * primary for **json_repair** (short, structured JSON fixes, gentler on free-tier burst limits). Allowlist in
 * `ingestionFinetuneLabelerPolicy` keeps sensitive labeler stages on `mistral` + `vertex` only by default
 * (`validation` is not a sensitive stage, so OpenAI may appear in its chain).
 */
export const CANONICAL_INGESTION_PRIMARY_MODELS: Record<IngestionLlmStageKey, CanonicalModelRef> = {
	extraction: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	relations: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	grouping: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	/** Never mirror extraction’s default Vertex Flash primary — cross-vendor first improves verification signal. */
	validation: { provider: 'mistral', modelId: 'mistral-large-latest' },
	remediation: { provider: 'vertex', modelId: 'gemini-3-flash-preview' },
	json_repair: { provider: 'mistral', modelId: 'mistral-medium-latest' }
};

/**
 * Ordered fallbacks after primary exhausts transient retries (429/5xx/timeout).
 * Heavy stages: deeper Gemini then Mistral sizes. json_repair: Gemini flash then larger Mistral tiers.
 */
export const CANONICAL_INGESTION_MODEL_FALLBACKS: Record<IngestionLlmStageKey, CanonicalModelRef[]> = {
	extraction: [
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' },
		{ provider: 'mistral', modelId: 'mistral-medium-latest' },
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
		{ provider: 'openai', modelId: 'gpt-4o-mini' },
		{ provider: 'openai', modelId: 'gpt-4o' },
		{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' }
	],
	remediation: [
		{ provider: 'vertex', modelId: 'gemini-3.1-pro-preview' },
		{ provider: 'mistral', modelId: 'mistral-medium-latest' },
		{ provider: 'mistral', modelId: 'mistral-large-latest' },
		{ provider: 'mistral', modelId: 'mistral-small-latest' }
	],
	json_repair: [
		{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
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
