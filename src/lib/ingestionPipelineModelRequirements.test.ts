import { describe, expect, it } from 'vitest';
import {
	computeIngestionPhaseSuitability,
	entryMeetsPresetStageMinimum,
	inferQualityTierFromModelIdentity,
	INGESTION_PIPELINE_PRESET,
	minimumQualityTierForStage,
	qualityTierAtLeast,
	resolveCatalogQualityCost
} from './ingestionPipelineModelRequirements';

describe('qualityTierAtLeast', () => {
	it('orders capable < strong < frontier', () => {
		expect(qualityTierAtLeast('strong', 'capable')).toBe(true);
		expect(qualityTierAtLeast('capable', 'strong')).toBe(false);
		expect(qualityTierAtLeast('frontier', 'strong')).toBe(true);
	});
});

describe('minimumQualityTierForStage', () => {
	it('raises embedding floor under high pressure', () => {
		expect(
			minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_embedding', {
				embeddingHighPressure: false
			})
		).toBe('capable');
		expect(
			minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_embedding', {
				embeddingHighPressure: true
			})
		).toBe('strong');
	});

	it('uses strong for relations and grouping', () => {
		expect(minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_relations')).toBe('strong');
		expect(minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_grouping')).toBe('strong');
	});

	it('uses capable for extraction, validation, and json repair', () => {
		expect(minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_extraction')).toBe('capable');
		expect(minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_validation')).toBe('capable');
		expect(minimumQualityTierForStage(INGESTION_PIPELINE_PRESET, 'ingestion_json_repair')).toBe('capable');
	});

	it('maps legacy preset inputs to production floors', () => {
		expect(minimumQualityTierForStage('budget', 'ingestion_extraction')).toBe('capable');
		expect(minimumQualityTierForStage('complexity', 'ingestion_grouping')).toBe('strong');
	});
});

describe('entryMeetsPresetStageMinimum', () => {
	it('accepts capable extraction models that pass structural gates', () => {
		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_extraction', {
				label: 'openai · gpt-4o-mini',
				provider: 'openai',
				modelId: 'gpt-4o-mini',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(true);

		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_extraction', {
				label: 'x · tiny-3b-instruct',
				provider: 'x',
				modelId: 'tiny-3b-instruct',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(false);
	});

	it('requires strong relations', () => {
		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_relations', {
				label: 'openai · gpt-4o-mini',
				provider: 'openai',
				modelId: 'gpt-4o-mini',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(false);

		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_relations', {
				label: 'openai · gpt-4o',
				provider: 'openai',
				modelId: 'gpt-4o',
				qualityTier: 'strong',
				costTier: 'medium'
			})
		).toBe(true);
	});

	it('requires strong grouping', () => {
		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_grouping', {
				label: 'anthropic · claude-haiku-4-5-20251001',
				provider: 'anthropic',
				modelId: 'claude-haiku-4-5-20251001',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(false);

		expect(
			entryMeetsPresetStageMinimum(INGESTION_PIPELINE_PRESET, 'ingestion_grouping', {
				label: 'anthropic · claude-sonnet-4-20250514',
				provider: 'anthropic',
				modelId: 'claude-sonnet-4-20250514',
				qualityTier: 'strong',
				costTier: 'medium'
			})
		).toBe(true);
	});

	it('allows strong models for grouping (legacy complexity-style picks)', () => {
		expect(
			entryMeetsPresetStageMinimum('complexity', 'ingestion_grouping', {
				label: 'anthropic · claude-sonnet-4-5-20250929',
				provider: 'anthropic',
				modelId: 'claude-sonnet-4-5-20250929',
				qualityTier: 'strong',
				costTier: 'high'
			})
		).toBe(true);
	});
});

describe('resolveCatalogQualityCost', () => {
	it('uses explicit tiers when present', () => {
		const r = resolveCatalogQualityCost({
			label: 'x · y',
			provider: 'a',
			modelId: 'b',
			qualityTier: 'frontier',
			costTier: 'high'
		});
		expect(r.qualityTier).toBe('frontier');
		expect(r.costTier).toBe('high');
	});
});

describe('inferQualityTierFromModelIdentity', () => {
	it('classifies flash as capable', () => {
		expect(inferQualityTierFromModelIdentity('vertex', 'gemini-3-flash-preview')).toBe('capable');
	});
});

describe('computeIngestionPhaseSuitability', () => {
	it('marks fetch as na and chat models as na for embedding stage', () => {
		const m = computeIngestionPhaseSuitability('openai', 'gpt-4o', false, {
			label: 'GPT-4o',
			qualityTier: 'strong',
			costTier: 'medium'
		});
		expect(m.ingestion_fetch).toBe('na');
		expect(m.ingestion_embedding).toBe('na');
		expect(m.ingestion_extraction).toBe('yes');
	});

	it('marks embedding models as na for extraction and yes for embedding when capable', () => {
		const m = computeIngestionPhaseSuitability('voyage', 'voyage-3-lite', true, {
			label: 'Voyage 3 Lite'
		});
		expect(m.ingestion_extraction).toBe('na');
		expect(m.ingestion_embedding).toBe('yes');
	});

	it('returns yes for capable extraction and weak for grouping when only capable-tier', () => {
		const m = computeIngestionPhaseSuitability('anthropic', 'claude-haiku-4-5-20251001', false, {
			label: 'Haiku',
			qualityTier: 'capable',
			costTier: 'low'
		});
		expect(m.ingestion_extraction).toBe('yes');
		expect(m.ingestion_grouping).toBe('weak');
	});
});
