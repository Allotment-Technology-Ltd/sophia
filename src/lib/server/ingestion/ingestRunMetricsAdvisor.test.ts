import { describe, expect, it } from 'vitest';
import {
	buildIngestMetricsAdvisory,
	scanLogLinesForIngestSignals
} from './ingestRunMetricsAdvisor.js';

describe('scanLogLinesForIngestSignals', () => {
	it('counts 429 and truncation hints', () => {
		const s = scanLogLinesForIngestSignals([
			'WARN 429 from provider',
			'Model output was truncated (max_tokens reached)',
			'[SPLIT] Relations batch hit TPM',
			'[PREEMPT] Splitting grouping batch',
			'[RECOVERY_AGENT] consult'
		]);
		expect(s.log_hints_429).toBeGreaterThanOrEqual(1);
		expect(s.log_hints_truncation).toBeGreaterThanOrEqual(1);
		expect(s.log_split_markers).toBe(1);
		expect(s.log_preempt_markers).toBe(1);
		expect(s.log_recovery_agent_markers).toBeGreaterThanOrEqual(1);
	});
});

describe('buildIngestMetricsAdvisory', () => {
	it('returns ok guidance when timing is missing', () => {
		const a = buildIngestMetricsAdvisory(null, {});
		expect(a.severity).toBe('ok');
		expect(a.recommendations.length).toBeGreaterThan(0);
	});

	it('flags high retries as action', () => {
		const a = buildIngestMetricsAdvisory(
			{
				total_wall_ms: 600_000,
				model_retries: 8,
				stage_ms: { extracting: 100_000, relating: 100_000, grouping: 50_000 }
			},
			{ log_hints_429: 5 }
		);
		expect(a.severity).toBe('action');
		expect(a.recommendations.some((r) => /429|retry/i.test(r))).toBe(true);
	});

	it('flags grouping-heavy wall share', () => {
		const a = buildIngestMetricsAdvisory(
			{
				total_wall_ms: 400_000,
				model_retries: 0,
				stage_ms: { extracting: 20_000, grouping: 200_000, embedding: 10_000 }
			},
			{}
		);
		expect(a.severity).toBe('watch');
		expect(a.recommendations.some((r) => /Grouping wall/i.test(r))).toBe(true);
	});

	it('flags remediation-heavy wall share', () => {
		const a = buildIngestMetricsAdvisory(
			{
				total_wall_ms: 500_000,
				model_retries: 0,
				stage_ms: { validating: 80_000, remediating: 200_000, embedding: 10_000 }
			},
			{}
		);
		expect(a.severity).toBe('watch');
		expect(a.signals.stage_wall_remediating_ms).toBe(200_000);
		expect(a.recommendations.some((r) => /Remediation phase dominated/i.test(r))).toBe(true);
	});
});
