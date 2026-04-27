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
			stage_models: { validation: 'vertex/gemini-3-flash-preview', extraction: 'mistral/mistral-large-latest' }
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

describe('classifyIngestLogLine stage + message enrichment', () => {
	it('infers group stage for mid-grouping resume lines', () => {
		const issue = classifyIngestLogLine(
			'  [RESUME] Mid-grouping checkpoint — resuming at batch 2/5',
			0
		);
		expect(issue?.kind).toBe('resume_checkpoint');
		expect(issue?.stageHint).toBe('group');
		expect(issue?.message).toContain('Mid-grouping');
	});

	it('summarizes [WARN] lines in the issue message', () => {
		const issue = classifyIngestLogLine(
			'  [WARN] grouping vertex/gemini failed: HTTP 429 | body: …',
			0
		);
		expect(issue?.kind).toBe('warning');
		expect(issue?.stageHint).toBe('group');
		expect(issue?.message).toContain('HTTP 429');
	});

	it('does not record redundant [RESUME] Previous status / Last completed stage lines', () => {
		expect(classifyIngestLogLine('[RESUME] Previous status: extracting', 0)).toBeNull();
		expect(classifyIngestLogLine('[RESUME] Last completed stage: none', 1)).toBeNull();
	});

	it('still records actionable resume lines', () => {
		const noCk = classifyIngestLogLine(
			'[RESUME] No checkpoint (Neon ingest_staging_* or data/ingested/*-partial.json) — restarting from scratch',
			0
		);
		expect(noCk?.kind).toBe('resume_checkpoint');
	});

	it('captures fatal remediation/json repair failures as high severity issues', () => {
		const issue = classifyIngestLogLine(
			'[FATAL ERROR] [remediation] Planned route and fallback chain exhausted (aizolo:x): JSON repair failed: Bad Request',
			0
		);
		expect(issue?.kind).toBe('fatal_error');
		expect(issue?.severity).toBe('high');
		expect(issue?.stageHint).toBe('remediation');
		expect(issue?.message).toContain('JSON repair failed');
	});

	it('ignores [SKIP] validation-only no-checkpoint exits', () => {
		expect(
			classifyIngestLogLine(
				'[SKIP] Validation-only: no Neon tail checkpoint for this source — exiting 0 (INGEST_VALIDATION_ONLY_NO_CHECKPOINT=skip).',
				0
			)
		).toBeNull();
	});
});

describe('classifyIngestLogLine self-heal', () => {
	it('classifies recovery_agent signal', () => {
		const line = formatIngestSelfHealLine({
			v: 1,
			signal: 'recovery_agent',
			stage: 'extraction',
			provider: 'vertex',
			model: 'gemini-3-flash-preview',
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
