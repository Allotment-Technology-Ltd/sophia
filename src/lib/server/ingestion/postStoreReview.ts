/**
 * Post-store quality routing: send low faithfulness claims to the human review queue
 * (review_state needs_review) and optionally flag verification_state for operator triage.
 */
import { createHash } from 'node:crypto';

export type ReviewState =
	| 'candidate'
	| 'accepted'
	| 'rejected'
	| 'merged'
	| 'needs_review';

/** Deterministic per-claim inclusion for sampled audit (stable across retries for same slug + position). */
export function deterministicPostStoreAuditSample(
	slug: string,
	position: number,
	rate: number
): boolean {
	if (rate >= 1) return true;
	if (rate <= 0) return false;
	const buf = createHash('sha256').update(`${slug}:${position}`).digest();
	const u = buf.readUInt32BE(0) / 4294967296;
	return u < rate;
}

export function resolvePostStoreClaimReviewState(input: {
	baseReviewState: ReviewState;
	faithfulnessScore: number | undefined;
	threshold: number | null;
	sampleRate: number;
	slug: string;
	position: number;
}): { reviewState: ReviewState; auditApplied: boolean } {
	const { baseReviewState, faithfulnessScore, threshold, sampleRate, slug, position } = input;
	if (threshold == null || faithfulnessScore == null || !Number.isFinite(faithfulnessScore)) {
		return { reviewState: baseReviewState, auditApplied: false };
	}
	if (faithfulnessScore >= threshold) {
		return { reviewState: baseReviewState, auditApplied: false };
	}
	if (baseReviewState === 'rejected' || baseReviewState === 'merged') {
		return { reviewState: baseReviewState, auditApplied: false };
	}
	if (!deterministicPostStoreAuditSample(slug, position, sampleRate)) {
		return { reviewState: baseReviewState, auditApplied: false };
	}
	return { reviewState: 'needs_review', auditApplied: true };
}

export function resolvePostStoreVerificationState(input: {
	baseVerificationState: string;
	faithfulnessAtLeast80: boolean;
	auditApplied: boolean;
	flagOnLowValidation: boolean;
}): string {
	if (input.faithfulnessAtLeast80) return 'validated';
	if (input.auditApplied && input.flagOnLowValidation) return 'flagged';
	return input.baseVerificationState;
}
