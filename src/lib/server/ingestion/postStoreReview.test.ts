import { describe, expect, it } from 'vitest';
import {
	deterministicPostStoreAuditSample,
	resolvePostStoreClaimReviewState,
	resolvePostStoreVerificationState
} from './postStoreReview.js';

describe('deterministicPostStoreAuditSample', () => {
	it('is stable for same slug and position', () => {
		expect(deterministicPostStoreAuditSample('my-slug', 7, 0.5)).toBe(
			deterministicPostStoreAuditSample('my-slug', 7, 0.5)
		);
	});

	it('respects rate 0 and 1', () => {
		expect(deterministicPostStoreAuditSample('s', 1, 0)).toBe(false);
		expect(deterministicPostStoreAuditSample('s', 1, 1)).toBe(true);
	});
});

describe('resolvePostStoreClaimReviewState', () => {
	it('forces needs_review when below threshold and sampled in', () => {
		const slug = 'golden-entry';
		const position = 3;
		const rate = 1;
		const { reviewState, auditApplied } = resolvePostStoreClaimReviewState({
			baseReviewState: 'candidate',
			faithfulnessScore: 40,
			threshold: 70,
			sampleRate: rate,
			slug,
			position
		});
		expect(reviewState).toBe('needs_review');
		expect(auditApplied).toBe(true);
	});

	it('does not override rejected', () => {
		const { reviewState } = resolvePostStoreClaimReviewState({
			baseReviewState: 'rejected',
			faithfulnessScore: 10,
			threshold: 90,
			sampleRate: 1,
			slug: 'x',
			position: 1
		});
		expect(reviewState).toBe('rejected');
	});
});

describe('resolvePostStoreVerificationState', () => {
	it('validates when faithfulness >= 80 path', () => {
		expect(
			resolvePostStoreVerificationState({
				baseVerificationState: 'unverified',
				faithfulnessAtLeast80: true,
				auditApplied: false,
				flagOnLowValidation: false
			})
		).toBe('validated');
	});

	it('flags when audit applied and flag on', () => {
		expect(
			resolvePostStoreVerificationState({
				baseVerificationState: 'unverified',
				faithfulnessAtLeast80: false,
				auditApplied: true,
				flagOnLowValidation: true
			})
		).toBe('flagged');
	});
});
