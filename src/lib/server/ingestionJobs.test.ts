import { afterEach, describe, expect, it } from 'vitest';
import {
	getIngestionJobItemMaxAttempts,
	ingestionJobAutoRequeueClearsChildRunId
} from './ingestionJobs';

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

describe('ingestionJobAutoRequeueClearsChildRunId', () => {
	afterEach(() => {
		delete process.env.INGEST_JOB_AUTO_REQUEUE_CLEAR_CHILD_RUN_ID;
	});

	it('defaults false (preserve child run id for checkpoint resume)', () => {
		expect(ingestionJobAutoRequeueClearsChildRunId()).toBe(false);
	});

	it('is true when INGEST_JOB_AUTO_REQUEUE_CLEAR_CHILD_RUN_ID=1', () => {
		process.env.INGEST_JOB_AUTO_REQUEUE_CLEAR_CHILD_RUN_ID = '1';
		expect(ingestionJobAutoRequeueClearsChildRunId()).toBe(true);
	});
});
