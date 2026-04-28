import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { fetchDatasetTopicPresetCoverage } from '$lib/server/metrics/datasetTopicPresetCoverage';
import {
	attachFollowUpsAndAiToInsights,
	buildDeterministicCoverageGateInsights
} from '$lib/server/metrics/datasetCoverageGateInsights';
import { buildGateFollowUpActions } from '$lib/server/metrics/datasetCoverageGateActionPlan';
import { generateCoverageGateAiSourceSuggestions } from '$lib/server/metrics/datasetCoverageGateAiSuggestions';

/**
 * Operator “gate insights” for dataset coverage.
 * Each request runs deterministic gates + follow-ups, then an LLM pass for ingest URLs on failing gates
 * (skipped when `SOPHIA_COVERAGE_GATE_AI=0`).
 */
export const POST: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);

	const aiKillSwitch = process.env.SOPHIA_COVERAGE_GATE_AI?.trim() === '0';

	const coverage = await fetchDatasetTopicPresetCoverage();
	const baseInsights = buildDeterministicCoverageGateInsights(coverage);
	const followUps = buildGateFollowUpActions(coverage);

	let gateAiSuggestions: Awaited<ReturnType<typeof generateCoverageGateAiSourceSuggestions>> | null = null;
	if (!aiKillSwitch) {
		gateAiSuggestions = await generateCoverageGateAiSourceSuggestions(coverage, baseInsights);
	}

	const insights = attachFollowUpsAndAiToInsights(baseInsights, followUps, gateAiSuggestions, !aiKillSwitch);

	return json({
		ok: true,
		insights,
		source: aiKillSwitch ? ('deterministic' as const) : ('deterministic+ai' as const)
	});
};
