import { describe, expect, it } from 'vitest';
import {
	buildValidationSourceSnippet,
	splitClaimsForValidationSnippetBudget,
	spanUnionWindowCharLength
} from './buildValidationSourceSnippet';

describe('buildValidationSourceSnippet', () => {
	it('returns the span union window when under maxChars', () => {
		const sourceText = 'x'.repeat(100);
		const claims = [{ source_span_start: 10, source_span_end: 19 }];
		const out = buildValidationSourceSnippet(claims, sourceText, {
			maxChars: 500,
			contextChars: 0
		});
		expect(out).toBe(sourceText.slice(10, 20));
	});

	it('applies context padding on both sides', () => {
		const sourceText = 'a'.repeat(5) + 'BODY' + 'b'.repeat(5);
		const claims = [{ source_span_start: 5, source_span_end: 8 }];
		const out = buildValidationSourceSnippet(claims, sourceText, {
			maxChars: 500,
			contextChars: 2
		});
		expect(out).toBe(sourceText.slice(3, 11));
	});

	it('center-truncates within the window when union+context exceeds maxChars', () => {
		const sourceText = 'a'.repeat(50_000);
		const claims = [{ source_span_start: 20_000, source_span_end: 40_000 }];
		const maxChars = 100;
		const out = buildValidationSourceSnippet(claims, sourceText, {
			maxChars,
			contextChars: 0
		});
		expect(out.length).toBe(maxChars);
		const unionMid = (20_000 + 40_000) / 2;
		const half = 50;
		expect(out).toBe(sourceText.slice(unionMid - half, unionMid - half + maxChars));
	});

	it('head-truncates when there are no usable spans', () => {
		const sourceText = 'z'.repeat(10_000);
		const maxChars = 100;
		const out = buildValidationSourceSnippet([], sourceText, { maxChars, contextChars: 800 });
		expect(out).toBe(sourceText.slice(0, maxChars));
	});
});

describe('spanUnionWindowCharLength', () => {
	it('returns window length including context', () => {
		const t = 'x'.repeat(1000);
		const claims = [{ source_span_start: 10, source_span_end: 19 }];
		// winStart=5, winEnd=25 → 20 chars (inclusive span end + exclusive slice)
		expect(spanUnionWindowCharLength(claims, t, 5)).toBe(20);
	});
});

describe('splitClaimsForValidationSnippetBudget', () => {
	it('splits when span union would exceed maxChars', () => {
		const sourceText = 'a'.repeat(100_000);
		const maxChars = 5000;
		const claims = [
			{ id: 'a', source_span_start: 100, source_span_end: 200 },
			{ id: 'b', source_span_start: 50_000, source_span_end: 50_100 }
		];
		const batches = splitClaimsForValidationSnippetBudget(claims, sourceText, {
			maxChars,
			contextChars: 0
		});
		expect(batches.length).toBe(2);
		expect(batches[0]).toHaveLength(1);
		expect(batches[1]).toHaveLength(1);
	});

	it('keeps single batch when union fits', () => {
		const sourceText = 'a'.repeat(10_000);
		const claims = [
			{ source_span_start: 100, source_span_end: 200 },
			{ source_span_start: 300, source_span_end: 400 }
		];
		const batches = splitClaimsForValidationSnippetBudget(claims, sourceText, {
			maxChars: 5000,
			contextChars: 0
		});
		expect(batches.length).toBe(1);
	});
});
