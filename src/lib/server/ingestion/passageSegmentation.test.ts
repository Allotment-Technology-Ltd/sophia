import { PassageRecordSchema } from '@restormel/contracts/ingestion';
import { describe, expect, it } from 'vitest';
import {
	buildPassageBatches,
	renderPassageBatch,
	segmentArgumentativePassages,
	splitPassageRecordForExtractionRetry
} from './passageSegmentation.js';

describe('segmentArgumentativePassages', () => {
	it('classifies common argumentative roles and preserves source spans', () => {
		const sourceText = `I argue that justice requires equal concern for persons.\n\nOne might object that merit should matter more than equality.\n\nIn reply, equal concern explains why merit must be assessed under fair conditions.\n\nBy liberty I mean non-domination rather than mere non-interference.`;

		const passages = segmentArgumentativePassages(sourceText, { maxTokensPerPassage: 80 });

		expect(passages).toHaveLength(4);
		expect(passages.map((passage) => passage.role)).toEqual([
			'thesis',
			'objection',
			'reply',
			'definition'
		]);
		expect(passages[0]?.span.start).toBe(0);
		expect(passages[0]?.span.end).toBeGreaterThan(10);
		expect(passages[3]?.summary.toLowerCase()).toContain('by liberty i mean');
	});

	it('builds extraction batches without losing passage ids', () => {
		const sourceText = `# I\n\nFor example, consider a physician facing a tragic triage choice.\n\nBecause duties constrain outcomes, the physician may not simply maximise welfare.`;
		const passages = segmentArgumentativePassages(sourceText, { maxTokensPerPassage: 40 });
		const batches = buildPassageBatches(passages, 18);

		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flat().map((passage) => passage.id)).toEqual(passages.map((passage) => passage.id));

		const rendered = renderPassageBatch(batches[0] ?? []);
		expect(rendered).toContain('<passage id="p0001"');
		expect(rendered).toContain('role="example"');
	});
});

describe('splitPassageRecordForExtractionRetry', () => {
	it('splits a long single passage at a paragraph boundary and preserves source spans', () => {
		const left = `${'Lorem ipsum. '.repeat(220).trim()}\n\n`;
		const right = `${'Dolor sit amet. '.repeat(220).trim()}`;
		const text = `${left}${right}`;
		const passage = PassageRecordSchema.parse({
			id: 'p0001',
			order_in_source: 1,
			section_title: null,
			text,
			summary: 'fixture',
			role: 'premise',
			role_confidence: 0.55,
			span: { start: 0, end: text.length - 1 }
		});
		const out = splitPassageRecordForExtractionRetry(passage, { minCharsPerPart: 400 });
		expect(out).not.toBeNull();
		const [p0, p1] = out!;
		expect(p0.text).toContain('Lorem ipsum');
		expect(p1.text).toContain('Dolor sit amet');
		expect(p0.text.length + p1.text.length).toBe(text.length);
		expect(p0.span.start).toBe(passage.span.start);
		expect(p1.span.end).toBe(passage.span.end);
		expect(p0.id.endsWith('-s0')).toBe(true);
		expect(p1.id.endsWith('-s1')).toBe(true);
	});

	it('returns null when the passage is too short to bisect safely', () => {
		const passage = segmentArgumentativePassages('short text', { maxTokensPerPassage: 9000 })[0]!;
		expect(splitPassageRecordForExtractionRetry(passage)).toBeNull();
	});
});
