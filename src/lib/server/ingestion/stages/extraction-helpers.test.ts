import { describe, expect, it } from 'vitest';
import { ExtractionOutputSchema } from '../../prompts/extraction.js';
import {
	coerceExtractionPayloadToClaimArray,
	isExtractionClaimRow,
	normalizeExtractionPayload
} from './extraction-helpers.js';

describe('coerceExtractionPayloadToClaimArray', () => {
	it('wraps a single claim object as a one-element array', () => {
		const one = {
			text: 'Hello world',
			claim_type: 'premise',
			domain: 'epistemology',
			passage_id: 'p1',
			section_context: 'Intro',
			position_in_source: 1,
			confidence: 0.9
		};
		expect(coerceExtractionPayloadToClaimArray(one)).toEqual([one]);
	});

	it('leaves arrays and non-claim objects unchanged', () => {
		expect(coerceExtractionPayloadToClaimArray([{ text: 'a', claim_type: 'premise' }])).toEqual([
			{ text: 'a', claim_type: 'premise' }
		]);
		expect(coerceExtractionPayloadToClaimArray({ claims: [] })).toEqual({ claims: [] });
		expect(coerceExtractionPayloadToClaimArray(null)).toBe(null);
	});
});

describe('isExtractionClaimRow', () => {
	it('is true only for plain objects with string text', () => {
		expect(isExtractionClaimRow({ text: 'x', claim_type: 'premise' })).toBe(true);
		expect(isExtractionClaimRow('fragment')).toBe(false);
		expect(isExtractionClaimRow(null)).toBe(false);
		expect(isExtractionClaimRow({ claim_type: 'premise' })).toBe(false);
	});
});

describe('normalizeExtractionPayload + ExtractionOutputSchema', () => {
	it('accepts a bare object after coercion (vendor FT shape)', () => {
		const raw = {
			text: 'Hence doubt matters.',
			claim_type: 'premise',
			claim_origin: 'source_grounded',
			domain: 'epistemology',
			passage_id: 'p0054',
			section_context: '3. Cogito',
			position_in_source: 26,
			confidence: 0.9
		};
		const normalized = normalizeExtractionPayload(raw, undefined);
		const out = ExtractionOutputSchema.parse(normalized);
		expect(out).toHaveLength(1);
		expect(out[0]!.text).toBe('Hence doubt matters.');
	});

	it('drops string fragments so Zod sees only claim objects (jsonrepair / inner-slice junk)', () => {
		const junk = ['not a claim', 'also not', { text: 'Real claim', claim_type: 'premise', domain: 'epistemology' }];
		const normalized = normalizeExtractionPayload(junk, undefined) as unknown[];
		expect(normalized).toHaveLength(1);
		const out = ExtractionOutputSchema.parse(normalized);
		expect(out[0]!.text).toBe('Real claim');
	});
});
