import { afterEach, describe, expect, it } from 'vitest';
import {
	filterModelTiersForFinetunePolicy,
	ingestFinetuneLabelerStrictEnabled,
	isFinetuneSensitiveLlmStage,
	parseFinetuneLabelerAllowedProviders
} from './ingestionFinetuneLabelerPolicy';

describe('ingestionFinetuneLabelerPolicy', () => {
	afterEach(() => {
		delete process.env.INGEST_FINETUNE_LABELER_STRICT;
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
	});

	it('defaults strict to on', () => {
		delete process.env.INGEST_FINETUNE_LABELER_STRICT;
		expect(ingestFinetuneLabelerStrictEnabled(process.env)).toBe(true);
	});

	it('respects INGEST_FINETUNE_LABELER_STRICT=0', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '0';
		expect(ingestFinetuneLabelerStrictEnabled(process.env)).toBe(false);
	});

	it('defaults allowed providers to mistral', () => {
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		expect(parseFinetuneLabelerAllowedProviders(process.env)).toEqual(['mistral']);
	});

	it('parses INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS', () => {
		process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS = 'mistral, vertex';
		expect(parseFinetuneLabelerAllowedProviders(process.env)).toEqual(['mistral', 'vertex']);
	});

	it('classifies sensitive stages', () => {
		expect(isFinetuneSensitiveLlmStage('extraction')).toBe(true);
		expect(isFinetuneSensitiveLlmStage('validation')).toBe(false);
	});

	it('filters tiers when strict', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		const tiers = [
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			{ provider: 'mistral', modelId: 'mistral-large-latest' }
		];
		expect(filterModelTiersForFinetunePolicy('extraction', tiers, process.env)).toEqual([
			{ provider: 'mistral', modelId: 'mistral-large-latest' }
		]);
	});

	it('does not filter validation stage', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		const tiers = [
			{ provider: 'openai', modelId: 'gpt-4o' },
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' }
		];
		expect(filterModelTiersForFinetunePolicy('validation', tiers, process.env)).toEqual(tiers);
	});

	it('passes through when strict off', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '0';
		const tiers = [{ provider: 'openai', modelId: 'gpt-4o-mini' }];
		expect(filterModelTiersForFinetunePolicy('extraction', tiers, process.env)).toEqual(tiers);
	});
});
