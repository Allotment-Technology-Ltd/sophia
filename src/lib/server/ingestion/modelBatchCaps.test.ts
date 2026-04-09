import { describe, expect, it } from 'vitest';
import { capIngestBatchTargetForPlan, isContextLengthExceededError } from './modelBatchCaps.js';

describe('capIngestBatchTargetForPlan', () => {
	it('caps validation target for gpt-3.5 below a high env default', () => {
		const r = capIngestBatchTargetForPlan({
			stage: 'validation',
			requested: 100_000,
			provider: 'openai',
			model: 'gpt-3.5-turbo'
		});
		expect(r.modelCeiling).toBe(10_000);
		expect(r.value).toBe(10_000);
		expect(r.capped).toBe(true);
	});

	it('does not raise validation target above requested for large-context models', () => {
		const r = capIngestBatchTargetForPlan({
			stage: 'validation',
			requested: 50_000,
			provider: 'openai',
			model: 'gpt-4-turbo'
		});
		expect(r.value).toBe(50_000);
		expect(r.capped).toBe(false);
	});

	it('caps relations target for small-context models', () => {
		const r = capIngestBatchTargetForPlan({
			stage: 'relations',
			requested: 20_000,
			provider: 'openai',
			model: 'gpt-3.5-turbo'
		});
		expect(r.value).toBe(8_000);
		expect(r.capped).toBe(true);
	});

	it('allows larger relations batches for gpt-4o than gpt-4-turbo', () => {
		const o = capIngestBatchTargetForPlan({
			stage: 'relations',
			requested: 40_000,
			provider: 'openai',
			model: 'gpt-4o'
		});
		expect(o.modelCeiling).toBe(36_000);
		expect(o.value).toBe(36_000);
		const t = capIngestBatchTargetForPlan({
			stage: 'relations',
			requested: 40_000,
			provider: 'openai',
			model: 'gpt-4-turbo'
		});
		expect(t.modelCeiling).toBe(28_000);
		expect(t.value).toBe(28_000);
	});
});

describe('isContextLengthExceededError', () => {
	it('detects common provider messages', () => {
		expect(isContextLengthExceededError(new Error('context_length_exceeded'))).toBe(true);
		expect(
			isContextLengthExceededError(new Error('This model maximum context length is 8192 tokens'))
		).toBe(true);
		expect(isContextLengthExceededError(new Error('rate limit'))).toBe(false);
	});
});
