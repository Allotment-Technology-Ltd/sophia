import { describe, expect, it } from 'vitest';
import { ExtractionOutputSchema } from './extraction.js';

describe('ExtractionOutputSchema', () => {
	it('accepts passage_id null (repair / FT models may emit null)', () => {
		const out = ExtractionOutputSchema.parse([
			{
				text: 'Example claim text for schema.',
				claim_type: 'premise',
				domain: 'philosophy_general',
				passage_id: null,
				section_context: 'Intro',
				position_in_source: 1,
				confidence: 0.9
			}
		]);
		expect(out[0]!.passage_id).toBeUndefined();
	});
});
