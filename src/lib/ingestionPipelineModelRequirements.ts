/**
 * Preset × pipeline-stage minimum model quality floors for admin ingestion.
 * Budget / balanced / complexity tighten differently based on typical failure modes
 * (weak grouping, relation drift, shallow validation, brittle JSON repair).
 */

import type { IngestionCostTier, IngestionModelCatalogEntry, IngestionQualityTier } from './ingestionModelCatalog';
import { INGESTION_MODEL_CATALOG } from './ingestionModelCatalog';
import { isEmbeddingModelEntry } from './ingestionModelCatalogMerge';

export type IngestionPipelinePreset = 'budget' | 'balanced' | 'complexity';

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
	if (/(sonnet|gpt-4|gemini.*pro|grok-[23]|command-r[^+]|medium)/i.test(low)) {
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

/** Minimum quality tier for (preset, stage). Embedding may bump under high token pressure. */
export function minimumQualityTierForStage(
	preset: IngestionPipelinePreset,
	stageKey: string,
	options?: { embeddingHighPressure?: boolean }
): IngestionQualityTier {
	if (stageKey === 'ingestion_fetch') return 'capable';

	const table: Record<IngestionPipelinePreset, Record<string, IngestionQualityTier>> = {
		budget: {
			ingestion_extraction: 'capable',
			ingestion_relations: 'capable',
			ingestion_grouping: 'strong',
			ingestion_validation: 'strong',
			ingestion_embedding: 'capable',
			ingestion_json_repair: 'capable'
		},
		balanced: {
			ingestion_extraction: 'strong',
			ingestion_relations: 'strong',
			ingestion_grouping: 'strong',
			ingestion_validation: 'strong',
			ingestion_embedding: 'capable',
			ingestion_json_repair: 'capable'
		},
		complexity: {
			ingestion_extraction: 'strong',
			ingestion_relations: 'strong',
			ingestion_grouping: 'frontier',
			ingestion_validation: 'frontier',
			ingestion_embedding: 'strong',
			ingestion_json_repair: 'strong'
		}
	};

	let min = table[preset][stageKey] ?? 'strong';

	if (stageKey === 'ingestion_embedding' && options?.embeddingHighPressure && preset === 'balanced') {
		if (min === 'capable') min = 'strong';
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
 * Whether the catalog row meets preset × stage minimum quality (and structural gates).
 */
export function entryMeetsPresetStageMinimum(
	preset: IngestionPipelinePreset,
	stageKey: string,
	entry: CatalogLikeEntry,
	options?: { embed?: boolean; embeddingHighPressure?: boolean }
): boolean {
	const embed = options?.embed ?? stageKey === 'ingestion_embedding';
	if (!passesStructuralStageGate(stageKey, entry, embed)) return false;

	const { qualityTier } = resolveCatalogQualityCost(entry);
	const minQ = minimumQualityTierForStage(preset, stageKey, {
		embeddingHighPressure: options?.embeddingHighPressure
	});

	if (qualityTierAtLeast(qualityTier, minQ)) return true;

	/** Complexity grouping/validation: require frontier in catalog; allow strong if inference says frontier-capable family. */
	if (preset === 'complexity' && minQ === 'frontier') {
		if (qualityTier === 'strong') {
			const blob = labelBlob(entry);
			const nearFrontier =
				/(sonnet-4|opus|gpt-5|o3|gemini-2\.5-pro|gemini-3|reasoner|deepseek-r1|mistral-large|command-r\+)/i.test(
					blob
				);
			if (nearFrontier) return true;
		}
	}

	return false;
}
