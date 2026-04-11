import { describe, expect, it } from 'vitest';
import {
	effectiveRecoverySleepMs,
	isRetryableIngestModelError,
	isRetryableIngestModelErrorMessage
} from './recoveryAgent';

describe('isRetryableIngestModelErrorMessage', () => {
	it('returns true for rate limit style errors', () => {
		expect(isRetryableIngestModelErrorMessage('429 Too Many Requests')).toBe(true);
		expect(isRetryableIngestModelErrorMessage('Resource exhausted')).toBe(true);
		expect(isRetryableIngestModelErrorMessage('timeout connecting')).toBe(true);
	});

	it('returns false for obvious auth errors', () => {
		expect(isRetryableIngestModelErrorMessage('401 invalid API key')).toBe(false);
	});

	it('isRetryableIngestModelError reads nested TPM (AI SDK wrapper)', () => {
		const inner = new Error(
			'Request too large for gpt-4o on tokens per min (TPM): Limit 30000, Requested 34130'
		);
		const outer = new Error('Failed after 3 attempts. Last error: upstream');
		(outer as Error & { cause?: unknown }).cause = inner;
		expect(isRetryableIngestModelErrorMessage(outer.message)).toBe(false);
		expect(isRetryableIngestModelError(outer)).toBe(true);
	});
});

describe('effectiveRecoverySleepMs', () => {
	it('caps sleep for sleep_and_retry_once', () => {
		const prev = process.env.INGEST_RECOVERY_AGENT_MAX_SLEEP_MS;
		process.env.INGEST_RECOVERY_AGENT_MAX_SLEEP_MS = '5000';
		try {
			expect(
				effectiveRecoverySleepMs({
					action: 'sleep_and_retry_once',
					sleep_ms: 999_999
				})
			).toBe(5000);
		} finally {
			if (prev === undefined) delete process.env.INGEST_RECOVERY_AGENT_MAX_SLEEP_MS;
			else process.env.INGEST_RECOVERY_AGENT_MAX_SLEEP_MS = prev;
		}
	});

	it('returns 0 for proceed', () => {
		expect(effectiveRecoverySleepMs({ action: 'proceed_to_next_step' })).toBe(0);
	});
});
