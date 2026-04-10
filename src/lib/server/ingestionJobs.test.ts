import { afterEach, describe, expect, it } from 'vitest';
import { getIngestionJobItemMaxAttempts } from './ingestionJobs';

describe('getIngestionJobItemMaxAttempts', () => {
	afterEach(() => {
		delete process.env.INGEST_JOB_ITEM_MAX_ATTEMPTS;
	});

	it('defaults to 2', () => {
		expect(getIngestionJobItemMaxAttempts()).toBe(2);
	});

	it('respects INGEST_JOB_ITEM_MAX_ATTEMPTS', () => {
		process.env.INGEST_JOB_ITEM_MAX_ATTEMPTS = '5';
		expect(getIngestionJobItemMaxAttempts()).toBe(5);
	});

	it('clamps absurd values to 20', () => {
		process.env.INGEST_JOB_ITEM_MAX_ATTEMPTS = '999';
		expect(getIngestionJobItemMaxAttempts()).toBe(20);
	});
});
