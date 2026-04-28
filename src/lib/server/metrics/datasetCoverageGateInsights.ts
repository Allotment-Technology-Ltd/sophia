/**
 * Rule-based “gate insights” for dataset coverage — no LLM, no provider quota.
 * Optional enrichment: `attachFollowUpsAndAiToInsights` merges operator follow-ups + AI URLs per gate.
 */

import type { DatasetTopicPresetCoverageResult } from './datasetTopicPresetCoverage';
import type {
	CoverageGateAiSuggestionItem,
	CoverageGateAiSuggestionsPayload,
	GateFollowUpAction
} from '$lib/ingestion/operatorGateBootstrap';

export const GATE_TITLE_ANSWER_READY = 'Answer-ready pipeline (validate · embed · graph)';
export const GATE_TITLE_SEP_DEPTH = 'SEP topic depth for inquiries';
export const GATE_TITLE_GROUNDING_TRUSTED = 'Grounding-trusted share';

export type CoverageGateInsightGate = {
	gate: string;
	status: 'pass' | 'fail' | 'unknown';
	evidence: string;
	next_actions: string[];
	deep_links?: string[];
	/** Deterministic operator shortcuts (wizard bootstrap, triage links). */
	suggested_follow_ups?: GateFollowUpAction[];
	/** Present when `{ ai: true }` succeeded for this gate title. */
	ai_suggestion?: CoverageGateAiSuggestionItem;
};

export type CoverageGateInsights = {
	summary: string;
	gates: CoverageGateInsightGate[];
	/** Set when the client requested AI but the model call failed or produced nothing usable. */
	ai_error?: string;
	/** Model route metadata when AI suggestions were merged into gates. */
	ai_model?: { provider: string; modelId: string };
};

/**
 * Merge follow-up actions and (optional) AI suggestions into the matching gate rows for a single card UI.
 * @param surfaceAiMetadata When true, include `ai_error` / `ai_model` on the payload from the AI pass result.
 */
export function attachFollowUpsAndAiToInsights(
	base: CoverageGateInsights,
	followUps: GateFollowUpAction[],
	aiPayload: CoverageGateAiSuggestionsPayload | null,
	surfaceAiMetadata: boolean
): CoverageGateInsights {
	const ai_error =
		surfaceAiMetadata && aiPayload && aiPayload.ok === false ? aiPayload.error : undefined;
	const ai_model =
		surfaceAiMetadata && aiPayload && aiPayload.ok === true ? aiPayload.model : undefined;

	const byTitle = new Map(base.gates.map((g, i) => [g.gate, i]));
	const gates: CoverageGateInsightGate[] = base.gates.map((g) => ({ ...g }));

	function addFu(gateTitle: string, fu: GateFollowUpAction): void {
		const idx = byTitle.get(gateTitle);
		if (idx === undefined) return;
		const row = gates[idx];
		const cur = row.suggested_follow_ups ?? [];
		if (cur.some((x) => x.id === fu.id)) return;
		row.suggested_follow_ups = [...cur, fu];
	}

	for (const fu of followUps) {
		if (fu.id === 'requeue-not-ready-samples') addFu(GATE_TITLE_ANSWER_READY, fu);
		else if (fu.id === 'sep-topic-depth') addFu(GATE_TITLE_SEP_DEPTH, fu);
		else if (fu.id === 'review-grounding-trusted') addFu(GATE_TITLE_GROUNDING_TRUSTED, fu);
		else if (fu.id === 'thinker-backlog' || fu.id === 'failed-runs-dlq' || fu.id === 'durable-jobs') {
			const arIdx = byTitle.get(GATE_TITLE_ANSWER_READY);
			const ar = arIdx !== undefined ? gates[arIdx] : null;
			if (ar && (ar.status === 'fail' || ar.status === 'unknown')) {
				addFu(GATE_TITLE_ANSWER_READY, fu);
			} else {
				const first = gates.find((x) => x.status === 'fail' || x.status === 'unknown');
				if (first) addFu(first.gate, fu);
			}
		}
	}

	if (aiPayload?.ok === true) {
		for (const item of aiPayload.items) {
			const idx = byTitle.get(item.gateTitle);
			if (idx !== undefined) gates[idx].ai_suggestion = item;
		}
	}

	return {
		summary: base.summary,
		gates,
		...(ai_error ? { ai_error } : {}),
		...(ai_model ? { ai_model } : {})
	};
}

const LINK_COVERAGE = '/admin/ingest/operator/activity?panel=coverage';
/** Canonical “Runs” tab clears `panel` (see Monitoring `setMonitorPanel`). */
const LINK_RUNS = '/admin/ingest/operator/activity';
const LINK_HISTORY = '/admin/ingest/operator/activity?panel=history';
const LINK_DLQ = '/admin/ingest/operator/triage?panel=dlq';
const LINK_PROMOTE = '/admin/ingest/operator/triage?panel=promote';
const LINK_TRIAGE_ISSUES = '/admin/ingest/operator/triage?panel=issues';

function capActions(actions: string[], max = 6): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const a of actions) {
		const t = a.trim();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
		if (out.length >= max) break;
	}
	if (out.length === 0) return ['Open Inquiry corpus and triage the highest-impact gate above.'];
	return out;
}

/** Build Monitoring-style insights from the same payload as `/api/admin/metrics/dataset-coverage`. */
export function buildDeterministicCoverageGateInsights(
	coverage: DatasetTopicPresetCoverageResult
): CoverageGateInsights {
	const gates: CoverageGateInsightGate[] = [];

	// 1) Neon / persistence
	if (!coverage.neonIngestPersistence) {
		gates.push({
			gate: 'Neon ingest persistence',
			status: 'fail',
			evidence:
				'Neon is not configured (DATABASE_URL). Without it, operators cannot see which philosophy sources finished ingest and reached the graph for user inquiries.',
			next_actions: capActions([
				'Set DATABASE_URL (or enable Neon ingest persistence) for the deployment that serves this admin UI.',
				'Redeploy or restart, then refresh Inquiry corpus.'
			]),
			deep_links: [LINK_COVERAGE]
		});
	} else {
		gates.push({
			gate: 'Neon ingest persistence',
			status: 'pass',
			evidence:
				'Neon is on—completed runs, governance, and staging rollups are available so you can trust inquiry-corpus metrics.',
			next_actions: capActions(['Keep DATABASE_URL and migrations current.']),
			deep_links: [LINK_COVERAGE]
		});
	}

	// 2) Phase 1 block / handoff (only when Neon is on—otherwise the API error is already covered above)
	if (coverage.neonIngestPersistence) {
		if (coverage.phase1ReadinessError) {
			gates.push({
				gate: 'Reference URL cohort (golden ∪ recent validate)',
				status: 'fail',
				evidence: coverage.phase1ReadinessError,
				next_actions: capActions([
					'Fix the underlying error (often DB access or golden eval load), then refresh Inquiry corpus.',
					'Check server logs for `[datasetTopicPresetCoverage] phase1Readiness`.'
				]),
				deep_links: [LINK_COVERAGE, LINK_TRIAGE_ISSUES]
			});
		} else if (!coverage.phase1Readiness) {
			gates.push({
				gate: 'Reference URL cohort (golden ∪ recent validate)',
				status: 'unknown',
				evidence: 'Reference cohort block is missing with no error message (unexpected).',
				next_actions: capActions(['Refresh Inquiry corpus; if it persists, file a bug with the API response payload.']),
				deep_links: [LINK_COVERAGE]
			});
		} else {
			const p1 = coverage.phase1Readiness;
			const u = p1.union;
			const ok = p1.allUnionUrlsPhase2Ready === true;
			const evidenceParts = [
				`Reference cohort: ${u.uniqueUrls} URL(s).`,
				`${u.phase2ReadyCount} are fully validated, embedded, and written to the graph for retrieval.`,
				u.missingFromCorpus > 0 ? `${u.missingFromCorpus} not in corpus yet.` : null,
				u.notValidatePath > 0 ? `${u.notValidatePath} lack validate-on runs (weaker cross-check for user Q&A).` : null,
				u.incompletePipeline > 0 ? `${u.incompletePipeline} stuck short of vectors or graph write.` : null,
				u.skippedSurrealStore > 0 ? `${u.skippedSurrealStore} skipped graph store only.` : null
			].filter(Boolean);
			const actions: string[] = [];
			if (!ok && u.uniqueUrls > 0) {
				if (u.incompletePipeline > 0) {
					actions.push(
						`Re-run or repair up to ${u.incompletePipeline} URL(s) with incomplete embedding or store telemetry (use Run history + live monitor).`
					);
				}
				if (u.missingFromCorpus > 0) {
					actions.push(`Ingest or enqueue ${u.missingFromCorpus} cohort URL(s) that have no completed row yet.`);
				}
				if (u.notValidatePath > 0) {
					actions.push(
						`${u.notValidatePath} URL(s) need validate-on runs to satisfy the handoff bar (wizard / jobs with validate).`
					);
				}
				if (u.skippedSurrealStore > 0) {
					actions.push(
						`Review ${u.skippedSurrealStore} URL(s) that only skipped Surreal store—confirm no-graph-changes skips are acceptable.`
					);
				}
				if (actions.length === 0) {
					actions.push('Review sample URLs on Inquiry corpus and open per-run reports for gaps.');
				}
			} else if (ok) {
				actions.push('Core reference slice is answer-ready for this snapshot; keep monitoring as new sources land.');
			} else {
				actions.push('Cohort is empty—check golden-extraction-eval.json and the Neon validate cohort window.');
			}
			gates.push({
				gate: 'Answer-ready pipeline (validate · embed · graph)',
				status: ok ? 'pass' : u.uniqueUrls === 0 ? 'unknown' : 'fail',
				evidence: evidenceParts.join(' '),
				next_actions: capActions(actions),
				deep_links: [LINK_COVERAGE, LINK_RUNS, LINK_HISTORY]
			});
		}
	}

	// 3) SEP presets vs goal
	const behind = coverage.presets.filter((p) => p.ingestedCount < p.goal);
	if (coverage.presets.length > 0) {
		if (behind.length > 0) {
			const sample = behind
				.slice(0, 4)
				.map((p) => `${p.label}: ${p.ingestedCount}/${p.goal}`)
				.join('; ');
			gates.push({
				gate: 'SEP topic depth for inquiries',
				status: 'fail',
				evidence: `${behind.length} of ${coverage.presets.length} topic bundle(s) are below the target depth (${coverage.presetGoal} ingests each). Examples: ${sample}${behind.length > 4 ? '…' : ''}`,
				next_actions: capActions([
					'Queue SEP ingests for thin topics so users have enough passages to ask about.',
					'Cross-check slug ↔ keyword mapping if counts look wrong.'
				]),
				deep_links: [LINK_COVERAGE, LINK_PROMOTE]
			});
		} else {
			gates.push({
				gate: 'SEP topic depth for inquiries',
				status: 'pass',
				evidence: `All ${coverage.presets.length} topic bundle(s) meet or exceed the target depth (${coverage.presetGoal}).`,
				next_actions: capActions(['Keep ingesting new SEP material as the canon grows.']),
				deep_links: [LINK_COVERAGE]
			});
		}
	}

	if (coverage.sepIngestedOutsidePresets > 0) {
		gates.push({
			gate: 'SEP outside curated bundles',
			status: 'unknown',
			evidence: `${coverage.sepIngestedOutsidePresets} SEP source(s) sit outside the named topic bundles—often useful breadth for open-ended philosophy questions.`,
			next_actions: capActions([
				'Tune bundle keywords only if you want those entries grouped for reporting.',
				'Otherwise no action required.'
			]),
			deep_links: [LINK_COVERAGE]
		});
	}

	// 4) Staging rollup
	if (coverage.stagingSupervisionError) {
		gates.push({
			gate: 'Claim & relation staging',
			status: 'fail',
			evidence: coverage.stagingSupervisionError,
			next_actions: capActions([
				'Verify Neon connectivity and `ingest_staging_*` tables.',
				'Check logs for `[datasetTopicPresetCoverage] stagingSupervision`.'
			]),
			deep_links: [LINK_COVERAGE, LINK_TRIAGE_ISSUES]
		});
	} else if (coverage.stagingSupervision && coverage.neonIngestPersistence) {
		const s = coverage.stagingSupervision;
		gates.push({
			gate: 'Claim & relation staging',
			status: 'pass',
			evidence: `Structured philosophy payload in Neon for latest runs: ${s.neonBackedSourceCount} sources; ${s.dedupedClaimRows} claim rows; ${s.dedupedRelationRows} relation rows—this is what retrieval and Q&A build on.`,
			next_actions: capActions([
				'If counts stall while ingests run, inspect worker staging writes before users hit thin answers.'
			]),
			deep_links: [LINK_COVERAGE]
		});
	}

	// 5) Optional: grounding-trusted share vs blocked (informational when many excluded)
	const tot = coverage.totals;
	const excluded = tot.trainingNotAcceptableCount;
	const okTrain = tot.trainingAcceptableCount;
	if (coverage.neonIngestPersistence && excluded > 0 && okTrain + excluded > 5) {
		const ratio = okTrain / (okTrain + excluded);
		if (ratio < 0.35) {
			gates.push({
				gate: 'Grounding-trusted share',
				status: 'unknown',
				evidence: `Only ${okTrain} of ${okTrain + excluded} sources are in the trusted slice for grounded answers (${Math.round(ratio * 100)}%). The rest are blocked by governance or risky extraction lineage—users may see weaker coverage until fixed.`,
				next_actions: capActions([
					'Review `source_training_governance` and latest report envelopes (recovery-agent, circuit-open, lineage).',
					'Expand the trusted slice only when extraction routes are stable enough for philosophical Q&A.'
				]),
				deep_links: [LINK_COVERAGE, LINK_DLQ]
			});
		}
	}

	const fail = gates.filter((g) => g.status === 'fail').length;
	const pass = gates.filter((g) => g.status === 'pass').length;
	const unk = gates.filter((g) => g.status === 'unknown').length;
	const firstFail = gates.find((g) => g.status === 'fail');
	let summary: string;
	if (fail === 0 && unk === 0) {
		summary = `All ${pass} evaluated gate(s) pass. The inquiry corpus looks healthy for this snapshot—users get validated, embedded, graph-backed philosophy text. Keep watching as new sources complete.`;
	} else if (fail === 0) {
		summary = `No failing gates; ${pass} pass and ${unk} are informational. Skim those rows when planning what users can safely ask about.`;
	} else {
		summary = `${fail} gate(s) need action before you can rely on this slice for inquiries (${pass} pass, ${unk} unclear). Start with “${firstFail?.gate ?? 'failed gate'}”: ${firstFail?.evidence.slice(0, 220) ?? ''}${(firstFail?.evidence.length ?? 0) > 220 ? '…' : ''}`;
	}

	return { summary, gates };
}
