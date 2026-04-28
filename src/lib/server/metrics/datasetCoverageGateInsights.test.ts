import { describe, expect, it } from 'vitest';
import { buildDeterministicCoverageGateInsights } from './datasetCoverageGateInsights';
import type { DatasetTopicPresetCoverageResult } from './datasetTopicPresetCoverage';

function emptyCoverage(overrides: Partial<DatasetTopicPresetCoverageResult> = {}): DatasetTopicPresetCoverageResult {
	const base: DatasetTopicPresetCoverageResult = {
		generatedAt: '2026-01-01T00:00:00.000Z',
		neonIngestPersistence: true,
		surrealIngestionLogMerged: false,
		presetGoal: 10,
		presets: [],
		totals: {
			uniqueSourcesCompleted: 0,
			trainingAcceptableCount: 0,
			trainingNotAcceptableCount: 0,
			byOrigin: {}
		},
		sepIngestedOutsidePresets: 0,
		phase1Readiness: null,
		phase1ReadinessError: null,
		stagingSupervision: null,
		stagingSupervisionError: null,
		note: ''
	};
	return { ...base, ...overrides };
}

describe('buildDeterministicCoverageGateInsights', () => {
	it('flags Neon off and does not duplicate phase1 error gate', () => {
		const c = emptyCoverage({
			neonIngestPersistence: false,
			phase1Readiness: null,
			phase1ReadinessError: 'Neon ingest persistence is off (DATABASE_URL).',
			presets: [{ id: 'a', label: 'A', goal: 10, ingestedCount: 0, trainingAcceptableCount: 0, trainingNotAcceptableCount: 0, byOrigin: {} }]
		});
		const { gates } = buildDeterministicCoverageGateInsights(c);
		const neon = gates.filter((g) => g.gate === 'Neon ingest persistence');
		const phase1 = gates.filter((g) => g.gate === 'Reference URL cohort (golden ∪ recent validate)');
		expect(neon).toHaveLength(1);
		expect(neon[0]!.status).toBe('fail');
		expect(phase1).toHaveLength(0);
	});

	it('passes handoff when cohort is fully ready', () => {
		const c = emptyCoverage({
			phase1Readiness: {
				goldenFingerprint: 'abc',
				trainingCohortDays: 90,
				trainingCohortValidateOnly: true,
				trainingUrlCap: 3000,
				golden: {
					uniqueUrls: 1,
					withAnyCompletedIngest: 1,
					phase2ReadyCount: 1,
					missingFromCorpus: 0,
					notValidatePath: 0,
					incompletePipeline: 0,
					skippedSurrealStore: 0,
					sampleNotReady: []
				},
				training: {
					uniqueUrls: 0,
					withAnyCompletedIngest: 0,
					phase2ReadyCount: 0,
					missingFromCorpus: 0,
					notValidatePath: 0,
					incompletePipeline: 0,
					skippedSurrealStore: 0,
					sampleNotReady: []
				},
				union: {
					uniqueUrls: 1,
					withAnyCompletedIngest: 1,
					phase2ReadyCount: 1,
					missingFromCorpus: 0,
					notValidatePath: 0,
					incompletePipeline: 0,
					skippedSurrealStore: 0,
					sampleNotReady: []
				},
				allUnionUrlsPhase2Ready: true,
				note: 'test note'
			},
			presets: [{ id: 'p', label: 'Ethics', goal: 10, ingestedCount: 10, trainingAcceptableCount: 5, trainingNotAcceptableCount: 0, byOrigin: {} }],
			stagingSupervision: {
				neonBackedSourceCount: 2,
				dedupedClaimRows: 10,
				dedupedPassageSlotsWithClaims: 8,
				dedupedRelationRows: 4,
				trainingAcceptableNeonBackedSourceCount: 1,
				trainingAcceptableDedupedClaimRows: 5,
				trainingAcceptableDedupedPassageSlotsWithClaims: 4,
				trainingAcceptableDedupedRelationRows: 2
			}
		});
		const { gates, summary } = buildDeterministicCoverageGateInsights(c);
		const handoff = gates.find((g) => g.gate === 'Answer-ready pipeline (validate · embed · graph)');
		expect(handoff?.status).toBe('pass');
		expect(summary.toLowerCase()).toContain('pass');
	});
});
