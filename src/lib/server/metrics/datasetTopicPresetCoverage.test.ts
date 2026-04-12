import { describe, it, expect } from 'vitest';
import { getSepEntryTopicPresetMatches } from '$lib/server/sepEntryBatchPick';
import {
	isTrainingModuleAcceptableLineage,
	originBucketForUrl
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

	it('isTrainingModuleAcceptableLineage accepts clean envelope', () => {
		expect(
			isTrainingModuleAcceptableLineage(false, {
				routingStats: { degradedRouteCount: 0 },
				issueSummary: { retry: 3 }
			})
		).toBe(true);
	});

	it('isTrainingModuleAcceptableLineage accepts null envelope when not excluded', () => {
		expect(isTrainingModuleAcceptableLineage(false, null)).toBe(true);
	});

	it('getSepEntryTopicPresetMatches returns epistemology for epistemology entry', () => {
		const presets = getSepEntryTopicPresetMatches('https://plato.stanford.edu/entries/epistemology/');
		expect(presets).toContain('epistemology');
	});
});
