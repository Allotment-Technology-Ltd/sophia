import { describe, expect, it } from 'vitest';
import { normalizeValidationOutput } from './validation';

describe('normalizeValidationOutput', () => {
	it('coerces non-string summary and alias fields into the strict schema shape', () => {
		const parsed = normalizeValidationOutput({
			summary: {
				overall: 'Mostly faithful with a small number of relation issues.'
			},
			claims: [
				{
					position: '1',
					faithfulness_score: '91',
					faithfulness_issue: '',
					quarantine: 'false'
				}
			],
			relations: [
				{
					from: 1,
					to: '2',
					validity_score: '88',
					quarantine: 'yes'
				}
			],
			arguments: [
				{
					name: 'Rawls on public reason',
					coherence_score: '84'
				}
			],
			quarantine_items: ['claim:3', 17]
		});

		expect(parsed.summary).toContain('Mostly faithful');
		expect(parsed.claims?.[0]).toMatchObject({
			position_in_source: 1,
			faithfulness_score: 91,
			quarantine: false
		});
		expect(parsed.relations?.[0]).toMatchObject({
			from_position: 1,
			to_position: 2,
			validity_score: 88,
			quarantine: true
		});
		expect(parsed.arguments?.[0]).toMatchObject({
			argument_name: 'Rawls on public reason',
			coherence_score: 84
		});
		expect(parsed.quarantine_items).toEqual(['claim:3', '17']);
	});

	it('drops invalid entries and still returns a valid summary fallback', () => {
		const parsed = normalizeValidationOutput({
			claims: [{ position_in_source: 0, faithfulness_score: 50 }],
			relations: [{ from_position: 1, to_position: 0, validity_score: 10 }],
			arguments: [{ coherence_score: 40 }],
			summary: null
		});

		expect(parsed.summary).toContain('Validation completed');
		expect(parsed.claims).toBeUndefined();
		expect(parsed.relations).toBeUndefined();
		expect(parsed.arguments).toBeUndefined();
	});
});
