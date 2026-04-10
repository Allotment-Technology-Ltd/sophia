import { describe, expect, it } from 'vitest';
import { buildValidationSourceSnippet } from './buildValidationSourceSnippet';

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
