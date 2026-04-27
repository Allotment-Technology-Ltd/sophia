import { describe, expect, it } from 'vitest';
import {
	getIngestModelRetryPolicy,
	isProviderCapacityExhaustedError
} from './ingestModelErrorPolicy';

describe('ingestModelErrorPolicy', () => {
	it('treats AiZolo insufficient token responses as provider capacity exhausted', () => {
		const msg =
			'Payment Required | http: 402 | body: {"error":"Insufficient tokens. Please upgrade your plan"}';
		expect(isProviderCapacityExhaustedError(msg)).toBe(true);
		expect(getIngestModelRetryPolicy('aizolo', msg).retryable).toBe(false);
		expect(getIngestModelRetryPolicy('aizolo', msg).capacityExhausted).toBe(true);
	});

	it('uses conservative outer backoff for AiZolo 429s after SDK retries', () => {
		const policy = getIngestModelRetryPolicy(
			'aizolo',
			'Failed after 3 attempts. Last error: Too Many Requests'
		);
		expect(policy.retryable).toBe(true);
		expect(policy.backoffMs(1)).toBeGreaterThanOrEqual(15_000);
		expect(policy.backoffMs(3)).toBeGreaterThan(policy.backoffMs(1));
	});

	it('keeps normal retryable classification for generic 500 errors', () => {
		const policy = getIngestModelRetryPolicy('mistral', 'HTTP 500 provider unavailable');
		expect(policy.retryable).toBe(true);
		expect(policy.capacityExhausted).toBe(false);
		expect(policy.backoffMs(2)).toBe(2_000);
	});
});
