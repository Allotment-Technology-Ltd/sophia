import { describe, it, expect } from 'vitest';
import {
	adminIngestChildCountsTowardMaxConcurrent,
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

	it('awaiting_sync still occupies (stop-before-store preview)', () => {
		expect(
			ingestRunStillOccupiesLlmConcurrencySlot({
				status: 'awaiting_sync',
				currentStageKey: 'validate'
			})
		).toBe(true);
	});

	it('null run occupies (conservative)', () => {
		expect(ingestRunStillOccupiesLlmConcurrencySlot(null)).toBe(true);
	});
});

describe('adminIngestChildCountsTowardMaxConcurrent', () => {
	const alive = { killed: false as const, exitCode: null as number | null, signalCode: null as null };

	it('running store with live child does not count', () => {
		expect(
			adminIngestChildCountsTowardMaxConcurrent({
				status: 'running',
				currentStageKey: 'store',
				process: alive
			})
		).toBe(false);
	});

	it('running extract with live child counts', () => {
		expect(
			adminIngestChildCountsTowardMaxConcurrent({
				status: 'running',
				currentStageKey: 'extract',
				process: alive
			})
		).toBe(true);
	});

	it('terminal does not count even with process ref', () => {
		expect(
			adminIngestChildCountsTowardMaxConcurrent({
				status: 'done',
				currentStageKey: 'store',
				process: alive
			})
		).toBe(false);
	});

	it('exited child does not count', () => {
		expect(
			adminIngestChildCountsTowardMaxConcurrent({
				status: 'running',
				currentStageKey: 'extract',
				process: { ...alive, exitCode: 0 }
			})
		).toBe(false);
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
