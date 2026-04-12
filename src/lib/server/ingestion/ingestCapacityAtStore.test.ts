import { describe, it, expect } from 'vitest';
import { ingestRunStillOccupiesLlmConcurrencySlot } from './ingestCapacityAtStore';

describe('ingestCapacityAtStore', () => {
	it('store phase does not occupy', () => {
		expect(
			ingestRunStillOccupiesLlmConcurrencySlot({
				status: 'running',
				currentStageKey: 'store'
			})
		).toBe(false);
	});

	it('extract still occupies', () => {
		expect(
			ingestRunStillOccupiesLlmConcurrencySlot({
				status: 'running',
				currentStageKey: 'extract'
			})
		).toBe(true);
	});

	it('terminal runs do not occupy', () => {
		expect(ingestRunStillOccupiesLlmConcurrencySlot({ status: 'done', currentStageKey: 'store' })).toBe(
			false
		);
	});

	it('null run occupies (conservative)', () => {
		expect(ingestRunStillOccupiesLlmConcurrencySlot(null)).toBe(true);
	});
});
