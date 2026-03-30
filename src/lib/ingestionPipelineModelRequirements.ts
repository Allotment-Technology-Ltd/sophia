/**
 * Production ingestion quality floors for admin model picking (single profile).
 * Legacy presets (budget / balanced / complexity) map to this profile for analytics and old reports.
 */

import type { IngestionCostTier, IngestionModelCatalogEntry, IngestionQualityTier } from './ingestionModelCatalog';
import { INGESTION_MODEL_CATALOG } from './ingestionModelCatalog';
import { isEmbeddingModelEntry } from './ingestionModelCatalogMerge';
import { INGESTION_PIPELINE_PRESET, type IngestionPipelinePreset } from './ingestionCanonicalPipeline';

export type { IngestionPipelinePreset };
export { INGESTION_PIPELINE_PRESET };

/** Accept legacy stored values; all resolve to the same floors as `production`. */
export type IngestionPipelinePresetInput =
	| IngestionPipelinePreset
	| 'budget'
	| 'balanced'
	| 'complexity';

export function normalizeIngestionPipelinePreset(p: IngestionPipelinePresetInput | string | undefined): IngestionPipelinePreset {
	const v = (p ?? INGESTION_PIPELINE_PRESET).trim().toLowerCase();
	if (v === INGESTION_PIPELINE_PRESET) return INGESTION_PIPELINE_PRESET;
	if (v === 'budget' || v === 'balanced' || v === 'complexity') return INGESTION_PIPELINE_PRESET;
	return INGESTION_PIPELINE_PRESET;
}

/** Admin / Restormel stage keys (matches RESTORMEL_STAGES[].key). */
export type IngestionPipelineStageKey =
	| 'ingestion_fetch'
	| 'ingestion_extraction'
	| 'ingestion_relations'
	| 'ingestion_grouping'
	| 'ingestion_validation'
	| 'ingestion_embedding'
	| 'ingestion_json_repair';

const QUALITY_RANK: Record<IngestionQualityTier, number> = {
	capable: 1,
	strong: 2,
	frontier: 3
};

export function qualityTierAtLeast(
	tier: IngestionQualityTier,
	minimum: IngestionQualityTier
): boolean {
	return QUALITY_RANK[tier] >= QUALITY_RANK[minimum];
}

function lookupStaticCatalog(provider: string, modelId: string): IngestionModelCatalogEntry | undefined {
	const p = provider.trim().toLowerCase();
	const m = modelId.trim();
	return INGESTION_MODEL_CATALOG.find(
		(e) => e.provider.toLowerCase() === p && e.modelId === m
	);
}

/**
 * Heuristic quality when the model is not in the static catalog (e.g. new Restormel index rows).
 * Aligned with `inferEntry` in ingestionModelCatalogMerge.ts.
 */
export function inferQualityTierFromModelIdentity(provider: string, modelId: string): IngestionQualityTier {
	const low = `${provider} ${modelId}`.toLowerCase();
	if (
		/(opus|gpt-5|o1|o3|sonnet-4|reasoner|deepseek-r1|mistral-large|command-r\+|llama.*70b|qwen.*72b)/i.test(
			low
		)
	) {
		return 'frontier';
	}
	if (/(flash|mini|haiku|lite|nano|8b|7b|3b|small|turbo|fast)/i.test(low) && !/sonnet|pro|gpt-4[^o]/i.test(low)) {
		return 'capable';
	}
	if (/(sonnet|gpt-4|gemini.*pro|command-r[^+]|medium)/i.test(low)) {
		return 'strong';
	}
	return 'strong';
}

export function inferCostTierFromModelIdentity(provider: string, modelId: string): IngestionCostTier {
	const low = `${provider} ${modelId}`.toLowerCase();
	if (/(opus|gpt-5|o1|o3|reasoner|pro|large|xlarge)/i.test(low) && !/mini|flash|lite|nano|haiku|small/i.test(low)) {
		return 'high';
	}
	if (/(flash|mini|haiku|lite|nano|7b|3b|8b|small|turbo|gecko|e5-|bge-)/i.test(low)) {
		return 'low';
	}
	return 'medium';
}

export type CatalogLikeEntry = {
	provider: string;
	modelId: string;
	label: string;
	qualityTier?: IngestionQualityTier;
	costTier?: IngestionCostTier;
};

export function resolveCatalogQualityCost(entry: CatalogLikeEntry): {
	qualityTier: IngestionQualityTier;
	costTier: IngestionCostTier;
} {
	if (entry.qualityTier && entry.costTier) {
		return { qualityTier: entry.qualityTier, costTier: entry.costTier };
	}
	const staticHit = lookupStaticCatalog(entry.provider, entry.modelId);
	if (staticHit) {
		return { qualityTier: staticHit.qualityTier, costTier: staticHit.costTier };
	}
	return {
		qualityTier: inferQualityTierFromModelIdentity(entry.provider, entry.modelId),
		costTier: inferCostTierFromModelIdentity(entry.provider, entry.modelId)
	};
}

/** Minimum quality tier per stage for the production pipeline (aligned with canonical primaries + structural gates). */
const PRODUCTION_MIN_QUALITY: Record<string, IngestionQualityTier> = {
	ingestion_extraction: 'capable',
	ingestion_relations: 'strong',
	ingestion_grouping: 'strong',
	ingestion_validation: 'capable',
	ingestion_embedding: 'capable',
	ingestion_json_repair: 'capable'
};

/** Minimum quality tier for (preset, stage). Legacy presets ignored — all use production floors. */
export function minimumQualityTierForStage(
	_preset: IngestionPipelinePresetInput,
	stageKey: string,
	options?: { embeddingHighPressure?: boolean }
): IngestionQualityTier {
	if (stageKey === 'ingestion_fetch') return 'capable';

	let min = PRODUCTION_MIN_QUALITY[stageKey] ?? 'strong';

	if (stageKey === 'ingestion_embedding' && options?.embeddingHighPressure && min === 'capable') {
		min = 'strong';
	}

	return min;
}

const TINY_MODEL = /(nano|3b|7b)/i;

function labelBlob(entry: Pick<CatalogLikeEntry, 'label' | 'modelId'>): string {
	return `${entry.label} ${entry.modelId}`.toLowerCase();
}

function isLikelyTinyChatModel(entry: CatalogLikeEntry): boolean {
	if (isEmbeddingModelEntry(entry)) return false;
	return TINY_MODEL.test(labelBlob(entry));
}

function isJsonRepairFriendly(entry: CatalogLikeEntry): boolean {
	return /json|instruct|mini|haiku|flash|lite|nano/i.test(labelBlob(entry));
}

/**
 * Structural gates (size / modality) before quality tier — catches known-bad fits.
 */
export function passesStructuralStageGate(
	stageKey: string,
	entry: CatalogLikeEntry,
	embed: boolean
): boolean {
	if (stageKey === 'ingestion_fetch') return true;
	if (embed || stageKey === 'ingestion_embedding') {
		return isEmbeddingModelEntry(entry);
	}
	if (isLikelyTinyChatModel(entry)) {
		if (stageKey === 'ingestion_extraction' || stageKey === 'ingestion_relations') {
			return false;
		}
		if (stageKey === 'ingestion_grouping' || stageKey === 'ingestion_validation') {
			return false;
		}
		if (stageKey === 'ingestion_json_repair') {
			return isJsonRepairFriendly(entry);
		}
		return false;
	}
	if (stageKey === 'ingestion_json_repair') {
		return isJsonRepairFriendly(entry) || !isLikelyTinyChatModel(entry);
	}
	return true;
}

/**
 * Whether the catalog row meets production minimum quality (and structural gates).
 */
export function entryMeetsPresetStageMinimum(
	_preset: IngestionPipelinePresetInput,
	stageKey: string,
	entry: CatalogLikeEntry,
	options?: { embed?: boolean; embeddingHighPressure?: boolean }
): boolean {
	const embed = options?.embed ?? stageKey === 'ingestion_embedding';
	if (!passesStructuralStageGate(stageKey, entry, embed)) return false;

	const { qualityTier } = resolveCatalogQualityCost(entry);
	const minQ = minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, stageKey, {
		embeddingHighPressure: options?.embeddingHighPressure
	});

	return qualityTierAtLeast(qualityTier, minQ);
}

/** UI indicator per pipeline stage. */
export type IngestionPhaseSuitabilityLevel = 'yes' | 'weak' | 'no' | 'na';

/** Column order aligned with admin ingest Restormel stages. */
export const INGESTION_PHASE_COLUMN_ORDER: readonly IngestionPipelineStageKey[] = [
	'ingestion_fetch',
	'ingestion_extraction',
	'ingestion_relations',
	'ingestion_grouping',
	'ingestion_validation',
	'ingestion_embedding',
	'ingestion_json_repair'
] as const;

export const INGESTION_PHASE_TABLE_HEADING: Record<IngestionPipelineStageKey, string> = {
	ingestion_fetch: 'Fetch',
	ingestion_extraction: 'Extract',
	ingestion_relations: 'Relate',
	ingestion_grouping: 'Group',
	ingestion_validation: 'Validate',
	ingestion_embedding: 'Embed',
	ingestion_json_repair: 'JSON'
};

function catalogLikeFromCatalogRaw(
	providerType: string,
	modelId: string,
	raw: Record<string, unknown>
): CatalogLikeEntry {
	const label =
		typeof raw.label === 'string' && raw.label.trim()
			? raw.label.trim()
			: `${providerType} · ${modelId}`;
	const q = raw.qualityTier ?? raw.quality_tier;
	const c = raw.costTier ?? raw.cost_tier;
	const qualityTier =
		q === 'capable' || q === 'strong' || q === 'frontier' ? q : undefined;
	const costTier =
		c === 'low' || c === 'medium' || c === 'high' ? c : undefined;
	return { provider: providerType, modelId, label, qualityTier, costTier };
}

function suitabilityLevelForStage(
	stageKey: IngestionPipelineStageKey,
	entry: CatalogLikeEntry,
	isEmbeddingRow: boolean
): IngestionPhaseSuitabilityLevel {
	if (stageKey === 'ingestion_fetch') {
		return 'na';
	}
	if (stageKey === 'ingestion_embedding') {
		if (!isEmbeddingRow) return 'na';
	} else if (isEmbeddingRow) {
		return 'na';
	}

	const embed = stageKey === 'ingestion_embedding';
	if (entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, stageKey, entry, { embed })) {
		return 'yes';
	}
	// Structural pass + at least capable: operator hint only (below production floor).
	if (passesStructuralStageGate(stageKey, entry, embed)) {
		const { qualityTier } = resolveCatalogQualityCost(entry);
		if (qualityTierAtLeast(qualityTier, 'capable')) return 'weak';
	}
	return 'no';
}

/**
 * Per-stage suitability for the model availability / operations picker.
 * **yes** = meets production floor; **weak** = structurally ok but below production quality; **no** = blocked.
 */
export function computeIngestionPhaseSuitability(
	providerType: string,
	modelId: string,
	isEmbedding: boolean,
	raw: Record<string, unknown>
): Record<IngestionPipelineStageKey, IngestionPhaseSuitabilityLevel> {
	const entry = catalogLikeFromCatalogRaw(providerType, modelId, raw);
	const out = {} as Record<IngestionPipelineStageKey, IngestionPhaseSuitabilityLevel>;
	for (const key of INGESTION_PHASE_COLUMN_ORDER) {
		out[key] = suitabilityLevelForStage(key, entry, isEmbedding);
	}
	return out;
}

export function ingestionPhaseSuitabilityTitle(
	stageKey: IngestionPipelineStageKey,
	level: IngestionPhaseSuitabilityLevel
): string {
	const stage = INGESTION_PHASE_TABLE_HEADING[stageKey];
	if (level === 'na') {
		if (stageKey === 'ingestion_fetch') {
			return `${stage}: not LLM-backed (fetch/parse only)`;
		}
		if (stageKey === 'ingestion_embedding') {
			return `${stage}: not an embedding model`;
		}
		return `${stage}: embedding models are not used in this stage`;
	}
	if (level === 'yes') {
		return `${stage}: meets production pipeline quality floor`;
	}
	if (level === 'weak') {
		return `${stage}: below production floor — usable only for experiments`;
	}
	return `${stage}: below production floor or failed structural gate (e.g. size/modality)`;
}
