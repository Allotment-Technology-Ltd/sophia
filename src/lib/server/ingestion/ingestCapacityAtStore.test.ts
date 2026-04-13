import { describe, it, expect } from 'vitest';
import {
	computeIngestionJobTickSpawnCap,
	ingestRunStillOccupiesLlmConcurrencySlot
} from './ingestCapacityAtStore';

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

describe('computeIngestionJobTickSpawnCap', () => {
	it('cold start allows full concurrency', () => {
		expect(
			computeIngestionJobTickSpawnCap({
				jobConcurrency: 4,
				llmSlotOccupants: 0,
				runningItemCount: 0
			})
		).toBe(4);
	});

	it('all workers in store caps to one new spawn per tick', () => {
		expect(
			computeIngestionJobTickSpawnCap({
				jobConcurrency: 4,
				llmSlotOccupants: 0,
				runningItemCount: 4
			})
		).toBe(1);
	});

	it('mixed LLM load uses remaining LLM slots', () => {
		expect(
			computeIngestionJobTickSpawnCap({
				jobConcurrency: 4,
				llmSlotOccupants: 2,
				runningItemCount: 3
			})
		).toBe(2);
	});
});
