import { describe, expect, it } from 'vitest';
import type { ValidationOutput } from '$lib/server/prompts/validation.js';
import { summarizeRemediationRevalidationDiff } from './validation-helpers.js';

describe('summarizeRemediationRevalidationDiff', () => {
	it('counts lowered min and quarantine tightening', () => {
		const first: ValidationOutput = {
			claims: [
				{ position_in_source: 1, faithfulness_score: 90, quarantine: false },
				{ position_in_source: 2, faithfulness_score: 70, quarantine: true }
			],
			relations: [
				{ from_position: 1, to_position: 2, validity_score: 88, quarantine: false }
			],
			arguments: [{ argument_name: 'A', coherence_score: 80, quarantine: false }],
			summary: 'x'
		};
		const second: ValidationOutput = {
			claims: [
				{ position_in_source: 1, faithfulness_score: 85, quarantine: true },
				{ position_in_source: 2, faithfulness_score: 70, quarantine: true }
			],
			relations: [
				{ from_position: 1, to_position: 2, validity_score: 88, quarantine: false }
			],
			arguments: [{ argument_name: 'A', coherence_score: 80, quarantine: false }],
			summary: 'y'
		};
		const d = summarizeRemediationRevalidationDiff(first, second);
		expect(d.claims.compared).toBe(2);
		expect(d.claims.second_lowered_min).toBe(1);
		expect(d.claims.quarantine_tightened_by_second).toBe(1);
		expect(d.claims.mean_min_faithfulness).toBeCloseTo((Math.min(90, 85) + Math.min(70, 70)) / 2);
		expect(d.relations.second_same_score).toBe(1);
		expect(d.arguments.second_same_score).toBe(1);
	});
});
