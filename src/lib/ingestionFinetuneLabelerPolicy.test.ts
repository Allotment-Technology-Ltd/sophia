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

	it('defaults allowed providers to together, mistral, vertex, deepseek, groq, and aizolo', () => {
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		expect(parseFinetuneLabelerAllowedProviders(process.env)).toEqual([
			'together',
			'mistral',
			'vertex',
			'deepseek',
			'groq',
			'aizolo'
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
			{ provider: 'together', modelId: 'meta-llama/Llama-3.3-70B' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			{ provider: 'mistral', modelId: 'mistral-large-latest' }
		];
		expect(filterModelTiersForFinetunePolicy('extraction', tiers, process.env)).toEqual([
			{ provider: 'together', modelId: 'meta-llama/Llama-3.3-70B' },
			{ provider: 'mistral', modelId: 'mistral-large-latest' }
		]);
	});

	it('keeps together, vertex, deepseek, mistral, groq, and aizolo on relations when strict with defaults', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		const tiers = [
			{ provider: 'together', modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
			{ provider: 'deepseek', modelId: 'deepseek-chat' },
			{ provider: 'mistral', modelId: 'mistral-medium-latest' },
			{ provider: 'groq', modelId: 'llama-3.1-8b-instant' },
			{ provider: 'aizolo', modelId: 'aizolo-gemini-gemini-3-flash-preview' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' }
		];
		expect(filterModelTiersForFinetunePolicy('relations', tiers, process.env)).toEqual([
			{ provider: 'together', modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' },
			{ provider: 'deepseek', modelId: 'deepseek-chat' },
			{ provider: 'mistral', modelId: 'mistral-medium-latest' },
			{ provider: 'groq', modelId: 'llama-3.1-8b-instant' },
			{ provider: 'aizolo', modelId: 'aizolo-gemini-gemini-3-flash-preview' }
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

	it('allows openai on json_repair when EXTRACTION_BASE_URL is set (repair via same FT endpoint)', () => {
		process.env.INGEST_FINETUNE_LABELER_STRICT = '1';
		delete process.env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS;
		process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
		const tiers = [
			{ provider: 'openai', modelId: 'accounts/foo/models/bar' },
			{ provider: 'vertex', modelId: 'gemini-3-flash-preview' }
		];
		expect(filterModelTiersForFinetunePolicy('json_repair', tiers, process.env)).toEqual(tiers);
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
