import { describe, expect, it } from 'vitest';
import {
	collectErrorMessageChain,
	isTpmOrRateLimitInError,
	isTpmOrRateLimitModelErrorMessage
} from './ingestionErrorChain';

describe('collectErrorMessageChain', () => {
	it('joins nested Error messages', () => {
		const inner = new Error('tokens per min (TPM): Limit 30000');
		const outer = new Error('Failed after 3 attempts. Last error: wrapper');
		(outer as Error & { cause?: unknown }).cause = inner;
		const s = collectErrorMessageChain(outer);
		expect(s).toContain('Failed after 3 attempts');
		expect(s).toContain('tokens per min');
	});

	it('handles non-Error', () => {
		expect(collectErrorMessageChain('plain')).toBe('plain');
	});

	it('detects TPM in nested cause', () => {
		const inner = new Error(
			'Request too large for gpt-4o on tokens per min (TPM): Limit 30000, Requested 34130'
		);
		const outer = new Error('Failed after 3 attempts. Last error: upstream');
		(outer as Error & { cause?: unknown }).cause = inner;
		expect(isTpmOrRateLimitModelErrorMessage(outer.message)).toBe(false);
		expect(isTpmOrRateLimitInError(outer)).toBe(true);
	});
});
