import { describe, expect, it } from 'vitest';
import { parseExtractionJsonFromModelResponse, parseJsonFromModelResponse } from './extractionModelJsonParse.js';

describe('parseExtractionJsonFromModelResponse', () => {
	it('parses a normal array', () => {
		const out = parseExtractionJsonFromModelResponse('[{"text":"a","claim_type":"premise"}]');
		expect(out).toEqual([{ text: 'a', claim_type: 'premise' }]);
	});

	it('recovers array when a stray object prefix precedes the array', () => {
		const junk =
			'{"text":"noise","claim_type":"premise","domain":"ethics","passage_id":"p1","section_context":"x","position_in_source":1,"confidence":1}[{"text":"real","claim_type":"thesis","domain":"ethics","passage_id":"p2","section_context":"y","position_in_source":2,"confidence":1}]';
		const out = parseExtractionJsonFromModelResponse(junk);
		expect(Array.isArray(out)).toBe(true);
		expect((out as { text: string }[])[0]!.text).toBe('real');
	});

	it('rethrows when nothing is parseable', () => {
		expect(() => parseExtractionJsonFromModelResponse('not json')).toThrow();
	});
});

describe('parseJsonFromModelResponse', () => {
	it('strips ```json fences', () => {
		const out = parseJsonFromModelResponse('```json\n[1]\n```');
		expect(out).toEqual([1]);
	});
});
