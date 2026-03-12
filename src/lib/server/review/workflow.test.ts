import { describe, expect, it } from 'vitest';
import {
	claimPromotionBlockers,
	relationPromotionBlockers,
	suggestDuplicateClassification
} from './workflow';
import type { ClaimReviewItem, RelationReviewItem } from './workflow';

function makeClaim(overrides: Partial<ClaimReviewItem> = {}): ClaimReviewItem {
	return {
		id: overrides.id ?? 'claim:1',
		text: overrides.text ?? 'Justice requires treating like cases alike.',
		claim_type: overrides.claim_type ?? 'thesis',
		domain: overrides.domain ?? 'ethics',
		confidence: overrides.confidence ?? 0.84,
		position_in_source: overrides.position_in_source ?? 1,
		passage_role: overrides.passage_role ?? 'thesis',
		review_state: overrides.review_state ?? 'candidate',
		verification_state: overrides.verification_state ?? 'unverified',
		source_span_start:
			Object.prototype.hasOwnProperty.call(overrides, 'source_span_start')
				? (overrides.source_span_start ?? null)
				: 0,
		source_span_end:
			Object.prototype.hasOwnProperty.call(overrides, 'source_span_end')
				? (overrides.source_span_end ?? null)
				: 42,
		source: overrides.source ?? { id: 'source:1', title: 'Theory of Justice' },
		promotable: overrides.promotable ?? true,
		blockers: overrides.blockers ?? [],
		merge_target: overrides.merge_target ?? null,
		merge_classification: overrides.merge_classification ?? null,
		review_notes: overrides.review_notes ?? null,
		reviewed_at: overrides.reviewed_at ?? null,
		reviewed_by: overrides.reviewed_by ?? null
	};
}

function makeRelation(overrides: Partial<RelationReviewItem> = {}): RelationReviewItem {
	return {
		id: overrides.id ?? 'supports:1',
		table: overrides.table ?? 'supports',
		strength: overrides.strength ?? 'strong',
		note: overrides.note ?? 'The premise directly supports the thesis.',
		relation_confidence: overrides.relation_confidence ?? 0.82,
		relation_inference_mode: overrides.relation_inference_mode ?? 'explicit',
		review_state: overrides.review_state ?? 'candidate',
		verification_state: overrides.verification_state ?? 'unverified',
		evidence_passages: overrides.evidence_passages ?? ['passage:1'],
		from_claim:
			overrides.from_claim ??
			({
				id: 'claim:1',
				text: 'Claim A',
				position_in_source: 1,
				review_state: 'accepted',
				verification_state: 'validated',
				source: { id: 'source:1', title: 'Source' }
			} as RelationReviewItem['from_claim']),
		to_claim:
			overrides.to_claim ??
			({
				id: 'claim:2',
				text: 'Claim B',
				position_in_source: 2,
				review_state: 'accepted',
				verification_state: 'validated',
				source: { id: 'source:1', title: 'Source' }
			} as RelationReviewItem['to_claim']),
		promotable: overrides.promotable ?? true,
		blockers: overrides.blockers ?? [],
		review_notes: overrides.review_notes ?? null,
		reviewed_at: overrides.reviewed_at ?? null,
		reviewed_by: overrides.reviewed_by ?? null
	};
}

describe('claimPromotionBlockers', () => {
	it('requires source-span provenance before promotion', () => {
		const blockers = claimPromotionBlockers(
			makeClaim({ source_span_start: null, source_span_end: null })
		);
		expect(blockers).toContain('missing_source_span');
	});

	it('blocks merged claims from promotion', () => {
		const blockers = claimPromotionBlockers(
			makeClaim({ review_state: 'merged', merge_target: 'claim:canonical' })
		);
		expect(blockers).toContain('merged');
		expect(blockers).toContain('merged_into_other_claim');
	});
});

describe('relationPromotionBlockers', () => {
	it('requires evidence passages for accepted relations', () => {
		const blockers = relationPromotionBlockers(makeRelation({ evidence_passages: [] }));
		expect(blockers).toContain('missing_evidence_passages');
	});

	it('blocks relations with merged endpoints', () => {
		const blockers = relationPromotionBlockers(
			makeRelation({
				from_claim: {
					id: 'claim:1',
					text: 'Claim A',
					position_in_source: 1,
					review_state: 'merged',
					verification_state: 'validated',
					source: { id: 'source:1', title: 'Source' }
				}
			})
		);
		expect(blockers).toContain('merged_endpoint');
	});
});

describe('suggestDuplicateClassification', () => {
	it('recognizes exact duplicates within the same source', () => {
		const left = makeClaim({ id: 'claim:1', text: 'Justice requires equal treatment.' });
		const right = makeClaim({
			id: 'claim:2',
			text: 'Justice requires equal treatment!'
		});
		const suggestion = suggestDuplicateClassification(left, right);
		expect(suggestion?.classification).toBe('exact_duplicate');
	});

	it('recognizes broader/narrower pairs before merge', () => {
		const left = makeClaim({
			id: 'claim:1',
			text: 'Rational agents deserve moral consideration.'
		});
		const right = makeClaim({
			id: 'claim:2',
			text: 'Rational agents deserve moral consideration when they can reciprocate social cooperation.'
		});
		const suggestion = suggestDuplicateClassification(left, right);
		expect(suggestion?.classification).toBe('broader_narrower');
	});
});
