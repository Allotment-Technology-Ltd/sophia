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
		delete process.env.EXTRACTION_BASE_URL;
	});

	it('defaults strict to on', () => {
		delete process.env.INGEST_FINETUNE_LABELER_STRICT;
		expect(ingestFinetuneLabelerStrictEnabled(process.env)).toBe(true);
	});

	it('respects INGEST_FINETUNE_LABELER_STRICT=0', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '0';
		expect(ingestFinetuneLabelerStrictEnabled(process.env)).toBe(false);
	});

	it('defaults allowed providers to mistral, vertex, deepseek, and groq', () => {
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		expect(parseFinetuneLabelerAllowedProviders(process.env)).toEqual([
			'mistral',
			'vertex',
			'deepseek',
			'groq'
		]);
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

	it('keeps vertex, deepseek, mistral, and groq on relations when strict with defaults', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		const tiers = [
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
			{ provider: 'deepseek', modelId: 'deepseek-chat' },
			{ provider: 'mistral', modelId: 'mistral-medium-latest' },
			{ provider: 'groq', modelId: 'llama-3.1-8b-instant' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' }
		];
		expect(filterModelTiersForFinetunePolicy('relations', tiers, process.env)).toEqual([
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
			{ provider: 'deepseek', modelId: 'deepseek-chat' },
			{ provider: 'mistral', modelId: 'mistral-medium-latest' },
			{ provider: 'groq', modelId: 'llama-3.1-8b-instant' }
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

	it('allows openai on extraction when EXTRACTION_BASE_URL is set (fine-tuned OpenAI-compatible primary)', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
		const tiers = [
			{ provider: 'openai', modelId: 'accounts/foo/models/bar' },
			{ provider: 'mistral', modelId: 'mistral-large-latest' }
		];
		expect(filterModelTiersForFinetunePolicy('extraction', tiers, process.env)).toEqual(tiers);
	});

	it('does not implicitly allow openai on relations when EXTRACTION_BASE_URL is set', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
		const tiers = [
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' }
		];
		expect(filterModelTiersForFinetunePolicy('relations', tiers, process.env)).toEqual([
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' }
		]);
	});
});
