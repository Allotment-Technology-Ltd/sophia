/**
 * Ingestion **embedding** defaults (Voyage 1024-dim corpus contract) and shared stage key types.
 *
 * **LLM** extraction → json_repair stages are **not** configured here. They come from
 * **Restormel Keys** routes (per-stage `ingestion_*` and optional Neon route bindings) and optional
 * `INGEST_CATALOG_ROUTING_JSON` for catalog ordering. See `callStageModel` in `scripts/ingest.ts` and
 * the Admin → Operator → Restormel routing screen.
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
