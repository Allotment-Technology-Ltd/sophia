import { describe, expect, it } from 'vitest';
import { RelationsOutputSchema } from './relations';

describe('RelationsOutputSchema', () => {
	it('normalizes legacy relation labels into the conservative ontology', () => {
		const parsed = RelationsOutputSchema.parse([
			{
				from_position: 1,
				to_position: 2,
				relation_type: 'refines',
				strength: 'moderate'
			},
			{
				from_position: 2,
				to_position: 3,
				relation_type: 'definition_of',
				strength: 'strong'
			},
			{
				from_position: 3,
				to_position: 4,
				relation_type: 'example_of',
				strength: 'weak'
			}
		]);

		expect(parsed.map((relation) => relation.relation_type)).toEqual([
			'qualifies',
			'defines',
			'supports'
		]);
	});

	it('rejects unsupported garbage relation labels', () => {
		expect(() =>
			RelationsOutputSchema.parse([
				{
					from_position: 1,
					to_position: 2,
					relation_type: 'related_to',
					strength: 'moderate'
				}
			])
		).toThrow();
	});
});
