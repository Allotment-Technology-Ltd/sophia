import { describe, expect, it } from 'vitest';
import {
	classifyIngestJobErrorMessage,
	computeLaunchThrottleBackoffMs,
	isLaunchThrottleError,
	shouldAutoRequeueIngestJobItem
} from './ingestionJobErrorClassify';

describe('classifyIngestJobErrorMessage', () => {
	it('marks rate limits retryable', () => {
		expect(classifyIngestJobErrorMessage('HTTP 429 Too Many Requests')).toBe('retryable');
	});

	it('marks 404 permanent', () => {
		expect(classifyIngestJobErrorMessage('HTTP 404: Not Found')).toBe('permanent');
	});

	it('marks unknown for empty', () => {
		expect(classifyIngestJobErrorMessage('')).toBe('unknown');
	});
});

describe('shouldAutoRequeueIngestJobItem', () => {
	it('skips permanent', () => {
		expect(shouldAutoRequeueIngestJobItem('404 not found')).toBe(false);
	});

	it('allows retryable', () => {
		expect(shouldAutoRequeueIngestJobItem('timeout')).toBe(true);
	});

	it('skips unknown by default', () => {
		expect(shouldAutoRequeueIngestJobItem('something weird happened')).toBe(false);
	});

	it('allows unknown when INGEST_JOB_REQUEUE_UNKNOWN=1', () => {
		process.env.INGEST_JOB_REQUEUE_UNKNOWN = '1';
		expect(shouldAutoRequeueIngestJobItem('something weird happened')).toBe(true);
		delete process.env.INGEST_JOB_REQUEUE_UNKNOWN;
	});
});

describe('isLaunchThrottleError', () => {
	it('detects concurrent worker cap', () => {
		expect(
			isLaunchThrottleError(
				'Too many concurrent ingest workers (2 max). Wait for a run to finish or raise ADMIN_INGEST_MAX_CONCURRENT.'
			)
		).toBe(true);
	});
});

describe('computeLaunchThrottleBackoffMs', () => {
	it('returns positive bounded backoff', () => {
		const a = computeLaunchThrottleBackoffMs(1);
		const b = computeLaunchThrottleBackoffMs(2);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThanOrEqual(a);
		expect(b).toBeLessThanOrEqual(700_000);
	});
});
