import { describe, it, expect } from 'vitest';
import { getSepEntryTopicPresetMatches } from '$lib/server/sepEntryBatchPick';
import {
	isTrainingModuleAcceptableLineage,
	originBucketForUrl,
	trainingLineageTimingVerdict
} from './datasetTopicPresetCoverage';

describe('datasetTopicPresetCoverage', () => {
	it('originBucketForUrl detects SEP', () => {
		expect(
			originBucketForUrl('https://plato.stanford.edu/entries/epistemology/', 'institutional')
		).toBe('SEP');
	});

	it('originBucketForUrl detects Gutenberg', () => {
		expect(originBucketForUrl('https://www.gutenberg.org/files/12345/12345-h/12345-h.htm', 'book')).toBe(
			'Gutenberg'
		);
	});

	it('originBucketForUrl uses host check for arXiv (not substring)', () => {
		expect(originBucketForUrl('https://arxiv.org/abs/2301.00001', 'paper')).toBe('arXiv / paper');
		expect(originBucketForUrl('https://export.arxiv.org/api/query', 'paper')).toBe('arXiv / paper');
		// PDF path is "paper" but host must not match via path substring (arxiv.org.evil.com ≠ arxiv.org)
		expect(originBucketForUrl('https://arxiv.org.evil.com/fake.pdf', 'paper')).toBe('Academic paper');
		expect(originBucketForUrl('https://example.org/research.pdf', 'paper')).toBe('Academic paper');
	});

	it('isTrainingModuleAcceptableLineage rejects governance excluded', () => {
		expect(isTrainingModuleAcceptableLineage(true, {})).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects degraded routes', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 1 },
				issueSummary: {}
			})
		).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects recovery_agent', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				issueSummary: { recovery_agent: 2 }
			})
		).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects envelope without verified stage_models lineage', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: { retry: 3 }
			})
		).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects null envelope when not excluded', () => {
		expect(isTrainingModuleAcceptableLineage(false, null)).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage accepts verified Vertex lineage on core stages', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: { retry: 3 },
				timingTelemetry: {
					stage_models: {
						extraction: 'vertex/gemini-3-flash-preview',
						relations: 'vertex/gemini-3-flash-preview',
						grouping: 'vertex/gemini-3-flash-preview'
					}
				}
			})
		).toBe(true);
	});

	it('isTrainingModuleAcceptableLineage accepts Mistral on core stages', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: {},
				timingTelemetry: {
					stage_models: {
						extraction: 'mistral/mistral-small-latest',
						relations: 'mistral/mistral-small-latest',
						grouping: 'mistral/mistral-small-latest'
					}
				}
			})
		).toBe(true);
	});

	it('isTrainingModuleAcceptableLineage rejects OpenAI on extraction', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: {},
				timingTelemetry: {
					stage_models: {
						extraction: 'openai/gpt-4o-mini',
						relations: 'vertex/gemini-3-flash-preview',
						grouping: 'vertex/gemini-3-flash-preview'
					}
				}
			})
		).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects OpenAI on validation when that stage is recorded', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: {},
				timingTelemetry: {
					stage_models: {
						extraction: 'vertex/gemini-3-flash-preview',
						relations: 'vertex/gemini-3-flash-preview',
						grouping: 'vertex/gemini-3-flash-preview',
						validation: 'openai/gpt-4o'
					}
				}
			})
		).toBe(false);
	});

	it('isTrainingModuleAcceptableLineage rejects explicit OpenAI in modelChain when telemetry missing', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: {},
				modelChain: { extract: 'OpenAI · GPT-4o', relate: 'auto', group: 'auto', validate: 'auto' }
			})
		).toBe(false);
	});

	it('trainingLineageTimingVerdict returns unknown without telemetry', () => {
		expect(trainingLineageTimingVerdict({})).toBe('unknown');
		expect(trainingLineageTimingVerdict({ timingTelemetry: {} })).toBe('unknown');
	});

	it('trainingLineageTimingVerdict returns ok for approved providers', () => {
		expect(
			trainingLineageTimingVerdict({
				timingTelemetry: {
					stage_models: {
						extraction: 'google/gemini-2.5-flash',
						relations: 'google/gemini-2.5-flash',
						grouping: 'google/gemini-2.5-flash'
					}
				}
			})
		).toBe('ok');
	});

	it('getSepEntryTopicPresetMatches returns epistemology for epistemology entry', () => {
		const presets = getSepEntryTopicPresetMatches('https://plato.stanford.edu/entries/epistemology/');
		expect(presets).toContain('epistemology');
	});
});
