import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH,
	estimateGroupingStructuredOutputTokens,
	groupingBatchPreemptReason,
	resolveGroupingPreemptMaxClaimsPerBatch
} from './groupingPreemptLimits.js';
import type { GroupingBatch, PhaseOneClaim } from './stages/types.js';

function minimalBatch(claimCount: number): GroupingBatch {
	const claims: PhaseOneClaim[] = Array.from({ length: claimCount }, (_, i) => ({
		text: 'x',
		claim_type: 'premise',
		domain: 'ethics',
		position_in_source: i + 1,
		confidence: 0.9
	})) as PhaseOneClaim[];
	return { claims, relations: [] };
}

describe('resolveGroupingPreemptMaxClaimsPerBatch', () => {
	it('defaults when unset', () => {
		expect(resolveGroupingPreemptMaxClaimsPerBatch({} as NodeJS.ProcessEnv)).toBe(
			DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH
		);
	});

	it('honors explicit positive cap', () => {
		expect(
			resolveGroupingPreemptMaxClaimsPerBatch({
				INGEST_GROUPING_MAX_CLAIMS_PER_BATCH: '50'
			} as NodeJS.ProcessEnv)
		).toBe(50);
	});

	it('treats 0 and unlimited as no cap', () => {
		expect(
			resolveGroupingPreemptMaxClaimsPerBatch({
				INGEST_GROUPING_MAX_CLAIMS_PER_BATCH: '0'
			} as NodeJS.ProcessEnv)
		).toBeUndefined();
		expect(
			resolveGroupingPreemptMaxClaimsPerBatch({
				INGEST_GROUPING_MAX_CLAIMS_PER_BATCH: 'unlimited'
			} as NodeJS.ProcessEnv)
		).toBeUndefined();
	});
});

describe('groupingBatchPreemptReason', () => {
	const smallFactor = 1.85;
	const maxOut = 65_536;
	const headroom = 0.82;

	it('returns claims when over claim cap', () => {
		const batch = minimalBatch(80);
		expect(
			groupingBatchPreemptReason({
				batch,
				maxOutputTokens: maxOut,
				outputHeadroomFraction: headroom,
				outputVsInputFactor: smallFactor,
				maxClaims: 72
			})
		).toBe('claims');
	});

	it('returns output when under claim cap but over output budget', () => {
		// estimateTokens ≈ wordCount * 1.3 — need structured est. > maxOut * headroom (65_536 * 0.82).
		const longText = 'word '.repeat(25_000);
		const batch: GroupingBatch = {
			claims: [
				{
					text: longText,
					claim_type: 'premise',
					domain: 'ethics',
					position_in_source: 1,
					confidence: 0.9
				} as PhaseOneClaim
			],
			relations: []
		};
		const est = estimateGroupingStructuredOutputTokens(batch, smallFactor);
		expect(est).toBeGreaterThan(Math.floor(maxOut * headroom));
		expect(
			groupingBatchPreemptReason({
				batch,
				maxOutputTokens: maxOut,
				outputHeadroomFraction: headroom,
				outputVsInputFactor: smallFactor,
				maxClaims: undefined
			})
		).toBe('output');
	});
});
