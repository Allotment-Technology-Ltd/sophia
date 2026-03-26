import { describe, expect, it } from 'vitest';
import { parseIngestTimingFromLogLines } from './ingestRunIssues';

describe('parseIngestTimingFromLogLines', () => {
	it('returns null when no timing line', () => {
		expect(parseIngestTimingFromLogLines(['hello', 'world'])).toBeNull();
	});

	it('parses the last [INGEST_TIMING] object line', () => {
		const lines = [
			'[INGEST_TIMING] {"stage_ms":{"extract":1}}',
			'noise',
			'[INGEST_TIMING] {"stage_ms":{"store":42},"retries":3}'
		];
		const parsed = parseIngestTimingFromLogLines(lines);
		expect(parsed).toEqual({ stage_ms: { store: 42 }, retries: 3 });
	});

	it('returns null for invalid JSON', () => {
		expect(parseIngestTimingFromLogLines(['[INGEST_TIMING] not-json'])).toBeNull();
	});

	it('returns null for non-object JSON', () => {
		expect(parseIngestTimingFromLogLines(['[INGEST_TIMING] [1,2]'])).toBeNull();
	});
});
