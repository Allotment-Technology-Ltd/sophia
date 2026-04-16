import { describe, expect, it } from 'vitest';
import {
	escapeUnescapedControlCharsInJsonStrings,
	parseExtractionJsonFromModelResponse,
	parseJsonFromModelResponse
} from './extractionModelJsonParse.js';

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

	it('recovers array when prose contains ASCII quotes inside a string value (jsonrepair)', () => {
		const dq = String.fromCharCode(34);
		// Model often omits backslashes — invalid JSON with interior quotes in `text`:
		const broken =
			'[{"text":"I call a perception ' + dq + 'clear' + dq + ' when present","claim_type":"premise"}]';
		const out = parseExtractionJsonFromModelResponse(broken) as { text: string; claim_type: string }[];
		expect(out[0]!.text).toBe('I call a perception "clear" when present');
		expect(out[0]!.claim_type).toBe('premise');
		const validEscaped =
			'[{"text":"I call a perception \\"clear\\" when present","claim_type":"premise"}]';
		expect(parseExtractionJsonFromModelResponse(validEscaped)).toEqual([
			{ text: 'I call a perception "clear" when present', claim_type: 'premise' }
		]);
	});

	it('recovers when model inserts ] between two objects after text: \\"…\\"]{\\"text\\":', () => {
		const broken =
			'{"text":"I now make the following statement: short quote (AT 7:51)."]' +
			'{"text":"I now make the following statement: longer body","keywords":["ignorance"],"passage_id":"p0030","section_context":"3. Mind","position_in_source":25,"confidence":1}';
		const out = parseExtractionJsonFromModelResponse(broken) as { text: string; passage_id?: string }[];
		expect(Array.isArray(out)).toBe(true);
		expect(out).toHaveLength(2);
		expect(out[0]!.text).toContain('short quote');
		expect(out[1]!.passage_id).toBe('p0030');
	});

	it('salvages multiple claims glued as …1][{"text":"… (truncated vendor array)', () => {
		const glued =
			'{"text":"(For further discussion, see Newman 1999, Williams 1978, and Wilson 1][{"text":"(For further discussion, see Newman 1999, Williams 1978, and Wilson 1][{"text":"(For further discussion, see Newman 1999, Williams 1978, and Wilson 1][{"text":"(For further discussion, see Newman 1999, Williams 1978, and Wilson 1}]';
		const out = parseExtractionJsonFromModelResponse(glued) as { text: string }[];
		expect(out).toHaveLength(4);
		expect(out[0]!.text).toContain('Newman 1999');
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

	it('parses JSON when a string value contains literal newlines (LLM output)', () => {
		const raw = '[{"text":"line one\nline two","claim_type":"premise"}]';
		const out = parseJsonFromModelResponse(raw);
		expect(out).toEqual([{ text: 'line one\nline two', claim_type: 'premise' }]);
	});

	it('does not corrupt already-escaped \\n inside strings', () => {
		const raw = String.raw`[{"text":"a\nb","claim_type":"premise"}]`;
		const out = parseJsonFromModelResponse(raw);
		expect(out).toEqual([{ text: 'a\nb', claim_type: 'premise' }]);
	});
});

describe('escapeUnescapedControlCharsInJsonStrings', () => {
	it('escapes quotes only when not preceded by backslash', () => {
		const raw = String.raw`[{"text":"say \"hi\"","x":1}]`;
		expect(JSON.parse(escapeUnescapedControlCharsInJsonStrings(raw))).toEqual([
			{ text: 'say "hi"', x: 1 }
		]);
	});
});
