import { describe, expect, it } from 'vitest';
import {
	entryMeetsPresetStageMinimum,
	inferQualityTierFromModelIdentity,
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
	it('raises balanced embedding floor under high pressure', () => {
		expect(
			minimumQualityTierForStage('balanced', 'ingestion_embedding', { embeddingHighPressure: false })
		).toBe('capable');
		expect(
			minimumQualityTierForStage('balanced', 'ingestion_embedding', { embeddingHighPressure: true })
		).toBe('strong');
	});

	it('uses frontier for complexity grouping and validation', () => {
		expect(minimumQualityTierForStage('complexity', 'ingestion_grouping')).toBe('frontier');
		expect(minimumQualityTierForStage('complexity', 'ingestion_validation')).toBe('frontier');
	});
});

describe('entryMeetsPresetStageMinimum', () => {
	it('rejects tiny models for extraction even on budget', () => {
		expect(
			entryMeetsPresetStageMinimum('budget', 'ingestion_extraction', {
				label: 'openai · gpt-4o-mini',
				provider: 'openai',
				modelId: 'gpt-4o-mini',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(true);

		expect(
			entryMeetsPresetStageMinimum('budget', 'ingestion_extraction', {
				label: 'x · tiny-3b-instruct',
				provider: 'x',
				modelId: 'tiny-3b-instruct',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(false);
	});

	it('requires strong grouping for budget preset', () => {
		expect(
			entryMeetsPresetStageMinimum('budget', 'ingestion_grouping', {
				label: 'anthropic · claude-3-5-haiku-20241022',
				provider: 'anthropic',
				modelId: 'claude-3-5-haiku-20241022',
				qualityTier: 'capable',
				costTier: 'low'
			})
		).toBe(false);

		expect(
			entryMeetsPresetStageMinimum('budget', 'ingestion_grouping', {
				label: 'anthropic · claude-3-5-sonnet-20241022',
				provider: 'anthropic',
				modelId: 'claude-3-5-sonnet-20241022',
				qualityTier: 'strong',
				costTier: 'medium'
			})
		).toBe(true);
	});

	it('allows near-frontier strong models for complexity grouping', () => {
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
		expect(inferQualityTierFromModelIdentity('vertex', 'gemini-2.5-flash')).toBe('capable');
	});
});
