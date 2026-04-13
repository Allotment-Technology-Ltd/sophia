import { describe, expect, it } from 'vitest';
import { classifyIngestJobErrorMessage, isLaunchThrottleError } from './ingestionJobErrorClassify';

describe('classifyIngestJobErrorMessage', () => {
	it('treats TPM / nested quota strings as retryable', () => {
		expect(
			classifyIngestJobErrorMessage('Error: 429 TPM nested: tokens per minute exceeded for model')
		).toBe('retryable');
		expect(classifyIngestJobErrorMessage('Resource exhausted (quota exceeded)')).toBe('retryable');
	});

	it('treats model overloaded messaging as retryable', () => {
		expect(classifyIngestJobErrorMessage('The model is overloaded. Please try again later.')).toBe(
			'retryable'
		);
	});

	it('still classifies obvious permanent failures', () => {
		expect(classifyIngestJobErrorMessage('HTTP 404 not found for url')).toBe('permanent');
	});

	it('treats Neon gate and local-process cap messages as launch throttle', () => {
		expect(
			isLaunchThrottleError(
				'Neon ingest concurrency gate is full (3 slots in ingest_concurrency_gate; INGEST_GLOBAL_CONCURRENCY_GATE=1).'
			)
		).toBe(true);
		expect(
			isLaunchThrottleError(
				'Too many concurrent ingest child processes on this server instance (3/3; ADMIN_INGEST_MAX_CONCURRENT).'
			)
		).toBe(true);
	});
});
