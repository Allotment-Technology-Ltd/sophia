import { describe, expect, it } from 'vitest';
import {
	buildPassageBatches,
	renderPassageBatch,
	segmentArgumentativePassages
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
