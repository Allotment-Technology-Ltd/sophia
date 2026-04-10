import { describe, expect, it } from 'vitest';
import {
	dropRelationsByValidation,
	selectRemediationPositions,
	sliceSourceAroundClaim,
	shouldRerunRelationsAfterRemediation
} from './remediationLogic.js';
import type { ValidationOutput } from '$lib/server/prompts/validation.js';
import type { Relation } from '$lib/server/prompts/relations.js';

describe('remediationLogic', () => {
	it('selects quarantine and low faithfulness', () => {
		const v = {
			claims: [
				{ position_in_source: 1, faithfulness_score: 90, quarantine: false },
				{ position_in_source: 2, faithfulness_score: 50, quarantine: false },
				{ position_in_source: 3, faithfulness_score: 90, quarantine: true }
			],
			summary: 'x'
		} as unknown as ValidationOutput;
		const pos = selectRemediationPositions(v, { faithfulnessMin: 80, maxClaims: 10 });
		expect(pos).toEqual([2, 3]);
	});

	it('drops quarantined relations', () => {
		const rels: Relation[] = [
			{
				from_position: 1,
				to_position: 2,
				relation_type: 'supports',
				strength: 'moderate',
				note: ''
			}
		];
		const v = {
			claims: [],
			relations: [{ from_position: 1, to_position: 2, validity_score: 10, quarantine: true }],
			summary: 'x'
		} as unknown as ValidationOutput;
		expect(dropRelationsByValidation(rels, v, 80)).toHaveLength(0);
	});

	it('sliceSourceAroundClaim pads span', () => {
		const t = '0123456789'.repeat(200);
		const s = sliceSourceAroundClaim(t, 100, 120, { maxChars: 50, pad: 5 });
		expect(s.length).toBeLessThanOrEqual(50);
	});

	it('shouldRerunRelationsAfterRemediation', () => {
		expect(
			shouldRerunRelationsAfterRemediation({
				remediatedPositions: new Set([1]),
				droppedRelationCount: 0,
				claimCount: 10,
				forceEnv: false,
				remediatedShareThreshold: 0.5
			})
		).toBe(false);
		expect(
			shouldRerunRelationsAfterRemediation({
				remediatedPositions: new Set([1]),
				droppedRelationCount: 1,
				claimCount: 10,
				forceEnv: false,
				remediatedShareThreshold: 0.5
			})
		).toBe(true);
	});
});
