import { describe, it, expect } from 'vitest';
import { normalizeGroupingPayload } from './grouping-helpers.js';

describe('normalizeGroupingPayload', () => {
	it('drops claim refs with missing position instead of coercing to 1', () => {
		const out = normalizeGroupingPayload([
			{
				name: 'Test',
				domain: 'ethics',
				summary: 's',
				claims: [{ role: 'conclusion' }, { position_in_source: 7, role: 'key_premise' }]
			}
		]) as { claims: { position_in_source: number }[] }[];
		expect(out[0]!.claims).toEqual([{ position_in_source: 7, role: 'key_premise' }]);
	});

	it('drops refs with invalid numeric position', () => {
		const out = normalizeGroupingPayload([
			{
				name: 'T',
				domain: 'logic',
				summary: 's',
				claims: [
					{ position_in_source: 0, role: 'conclusion' },
					{ position_in_source: 3, role: 'conclusion' }
				]
			}
		]) as { claims: { position_in_source: number }[] }[];
		expect(out[0]!.claims.map((c) => c.position_in_source)).toEqual([3]);
	});
});
