import { describe, expect, it } from 'vitest';
import { classifyIngestLogLine, parseIngestTimingFromLogLines } from './ingestRunIssues';
import { formatIngestSelfHealLine } from './ingestion/selfHealLog';

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

	it('preserves stage_models for validation comparability', () => {
		const timing = {
			stage_models: { validation: 'vertex/gemini-2.5-flash', extraction: 'openai/gpt-4o-mini' }
		};
		const parsed = parseIngestTimingFromLogLines([
			`[INGEST_TIMING] ${JSON.stringify(timing)}`
		]);
		expect(parsed?.stage_models).toEqual(timing.stage_models);
	});

	it('parses total_wall_ms when present', () => {
		const timing = { run_started_at_ms: 1, total_wall_ms: 900_000, stage_ms: {} };
		const parsed = parseIngestTimingFromLogLines([`[INGEST_TIMING] ${JSON.stringify(timing)}`]);
		expect(parsed?.total_wall_ms).toBe(900_000);
	});
});

describe('classifyIngestLogLine self-heal', () => {
	it('classifies recovery_agent signal', () => {
		const line = formatIngestSelfHealLine({
			v: 1,
			signal: 'recovery_agent',
			stage: 'extraction',
			provider: 'vertex',
			model: 'gemini-2.5-flash',
			outcome: 'sleep_retry',
			detail: 'after transient 429'
		});
		const issue = classifyIngestLogLine(line, 0);
		expect(issue?.kind).toBe('recovery_agent');
		expect(issue?.stageHint).toBe('extraction');
		expect(issue?.message).toContain('recovery_agent');
	});

	it('classifies circuit_open signal', () => {
		const line = formatIngestSelfHealLine({
			v: 1,
			signal: 'circuit_open',
			stage: 'validation',
			outcome: 'skipped_tier'
		});
		expect(classifyIngestLogLine(line, 1)?.kind).toBe('circuit_open');
	});
});
