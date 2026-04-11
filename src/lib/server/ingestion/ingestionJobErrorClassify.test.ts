import { describe, expect, it } from 'vitest';
import { classifyIngestJobErrorMessage } from './ingestionJobErrorClassify';

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
});
