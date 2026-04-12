/**
 * Rule-based ingest metrics advisory — no LLM. Consumes `[INGEST_TIMING]`-shaped telemetry
 * plus optional log-line heuristics (429 / truncation / split markers) to emit human-readable
 * recommendations and narrow guardrail hints for operators.
 *
 * Used by: `scripts/ingest.ts` (one-line `[INGEST_METRICS_ADVISORY]`), `ingestRunIssues` report
 * envelope, and offline `scripts/reports-ingest-tuning-neon.ts`.
 */

export type IngestMetricsAdvisorySeverity = 'ok' | 'watch' | 'action';

export type IngestMetricsAdvisory = {
	version: 1;
	severity: IngestMetricsAdvisorySeverity;
	recommendations: string[];
	guardrails: string[];
	/** Normalized numeric hints (counts, ratios, ms) for dashboards / scripts */
	signals: Record<string, number>;
};

function num(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : 0;
	}
	return 0;
}

function stageMs(timing: Record<string, unknown>, key: string): number {
	const sm = timing.stage_ms;
	if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return 0;
	return num((sm as Record<string, unknown>)[key]);
}

function stageTokens(
	timing: Record<string, unknown>,
	mapKey: 'stage_input_tokens' | 'stage_output_tokens',
	stage: string
): number {
	const m = timing[mapKey];
	if (!m || typeof m !== 'object' || Array.isArray(m)) return 0;
	return num((m as Record<string, unknown>)[stage]);
}

/**
 * Scan stdout log lines for cheap rate / truncation / split signals (Neon `ingest_run_logs`).
 */
export function scanLogLinesForIngestSignals(logLines: string[]): Record<string, number> {
	let hints429 = 0;
	let truncationHints = 0;
	let splitMarkers = 0;
	let preemptMarkers = 0;
	let recoveryAgentMarkers = 0;
	for (const line of logLines) {
		const L = line.toLowerCase();
		if (/\b429\b|rate limit|resource_exhausted|too many requests|tpm\b/i.test(L)) hints429++;
		if (/truncat|max_tokens reached|max_tokens|finishreason.*length|output was truncated/i.test(L))
			truncationHints++;
		if (/\[split\]/i.test(line)) splitMarkers++;
		if (/\[preempt\]/i.test(line)) preemptMarkers++;
		if (/\[recovery_agent\]/i.test(line) || /recovery_agent/i.test(L)) recoveryAgentMarkers++;
	}
	return {
		log_hints_429: hints429,
		log_hints_truncation: truncationHints,
		log_split_markers: splitMarkers,
		log_preempt_markers: preemptMarkers,
		log_recovery_agent_markers: recoveryAgentMarkers
	};
}

export function buildIngestMetricsAdvisory(
	timing: Record<string, unknown> | null | undefined,
	logSignals: Record<string, number> | null | undefined
): IngestMetricsAdvisory {
	const signals: Record<string, number> = { ...(logSignals ?? {}) };
	const recommendations: string[] = [];
	const guardrails: string[] = [];

	if (!timing || typeof timing !== 'object') {
		return {
			version: 1,
			severity: 'ok',
			recommendations: ['No timingTelemetry on this run — enable full worker logs or complete a run to populate [INGEST_TIMING].'],
			guardrails: [],
			signals
		};
	}

	const totalWall = num(timing.total_wall_ms);
	const retries = num(timing.model_retries);
	const batchSplits = num(timing.batch_splits);
	const jsonRepair = num(timing.json_repair_invocations);
	const recoveryInv = num(timing.recovery_agent_invocations);
	const backoff = num(timing.retry_backoff_ms_total);

	signals.total_wall_ms = totalWall;
	signals.model_retries = retries;
	signals.batch_splits = batchSplits;
	signals.json_repair_invocations = jsonRepair;
	signals.recovery_agent_invocations = recoveryInv;
	signals.retry_backoff_ms_total = backoff;

	const extWall = stageMs(timing, 'extracting');
	const relWall = stageMs(timing, 'relating');
	const grpWall = stageMs(timing, 'grouping');
	const embWall = stageMs(timing, 'embedding');
	const valWall = stageMs(timing, 'validating');

	signals.stage_wall_extracting_ms = extWall;
	signals.stage_wall_relating_ms = relWall;
	signals.stage_wall_grouping_ms = grpWall;
	signals.stage_wall_embedding_ms = embWall;
	signals.stage_wall_validating_ms = valWall;

	const grpIn = stageTokens(timing, 'stage_input_tokens', 'grouping');
	const grpOut = stageTokens(timing, 'stage_output_tokens', 'grouping');
	signals.grouping_input_tokens = grpIn;
	signals.grouping_output_tokens = grpOut;
	if (grpIn > 0) {
		signals.grouping_output_to_input_ratio = Math.round((1000 * grpOut) / grpIn) / 1000;
	}

	let severity: IngestMetricsAdvisorySeverity = 'ok';

	const bump = (next: IngestMetricsAdvisorySeverity) => {
		if (next === 'action') severity = 'action';
		else if (next === 'watch' && severity === 'ok') severity = 'watch';
	};

	if (retries >= 6 || signals.log_hints_429 >= 4) {
		bump('action');
		recommendations.push(
			'High model retry count or repeated 429 / rate-limit hints: lower durable job URL concurrency, reduce INGEST_EXTRACTION_CONCURRENCY or INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR, and/or set INGEST_PROVIDER_TPM_BUDGET for the hot provider.'
		);
		guardrails.push('Cap parallel pressure before widening batch targets or throughput toggles.');
	} else if (retries >= 3 || signals.log_hints_429 >= 2) {
		bump('watch');
		recommendations.push(
			'Moderate retries or occasional 429s in logs: watch Mistral RPS pacing (INGEST_MISTRAL_*), Vertex embed batch delay if embedding is Vertex, and job merge behaviour.'
		);
	}

	if (batchSplits >= 3 || signals.log_split_markers >= 3) {
		bump('watch');
		recommendations.push(
			'Frequent relations TPM splits ([SPLIT] in logs or high timing.batch_splits): lower RELATIONS_BATCH_TARGET_TOKENS or RELATIONS_BATCH_OVERLAP_CLAIMS, or reduce per-stage concurrency.'
		);
	}

	if (signals.log_hints_truncation >= 1 || (grpOut > 28_000 && grpIn > 0)) {
		bump('watch');
		recommendations.push(
			'Grouping output approached limits: keep INGEST_GROUPING_PREEMPT_OUTPUT_SPLITS on; tune GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS or INGEST_GROUPING_OUTPUT_VS_INPUT_FACTOR / INGEST_GROUPING_MAX_OUTPUT_TOKENS for Gemini.'
		);
	}

	if (signals.log_preempt_markers >= 1) {
		bump('watch');
		recommendations.push(
			'[PREEMPT] grouping splits fired — good safety valve; if runs are slower than needed, raise targets only after 429/truncation rates stay flat.'
		);
	}

	if (totalWall > 0 && grpWall > 120_000 && grpWall / totalWall > 0.35) {
		bump('watch');
		recommendations.push(
			'Grouping wall time dominates this run: verify grouping model routing, batch sizing envs above, and stage timeout INGEST_STAGE_GROUPING_TIMEOUT_MS vs source size.'
		);
	}

	if (embWall > 0 && totalWall > 0 && embWall / totalWall > 0.45) {
		bump('watch');
		recommendations.push(
			'Embedding phase dominated wall time: check VERTEX_EMBED_BATCH_SIZE / delay, Voyage batching, and corpus dimension migrations (INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM).'
		);
	}

	if (valWall > 0 && totalWall > 0 && valWall / totalWall > 0.35) {
		bump('watch');
		recommendations.push(
			'Validation wall time is high: lower VALIDATION_BATCH_TARGET_TOKENS or enable sampling (INGEST_VALIDATION_SAMPLE_RATE) if quality policy allows.'
		);
	}

	if (jsonRepair >= 4) {
		bump('watch');
		recommendations.push(
			'Many json_repair passes: extraction output may be unstable — review INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION, extraction model pin, or SEP/HTML parse path for this source type.'
		);
	}

	if (recoveryInv >= 1 || signals.log_recovery_agent_markers >= 1) {
		bump('watch');
		recommendations.push(
			'Recovery agent engaged (INGEST_RECOVERY_AGENT=1): review provider outages; agent only advises bounded sleep — it does not retune batch sizes automatically.'
		);
	}

	if (backoff > 120_000) {
		bump('watch');
		recommendations.push(
			'Large cumulative retry backoff — transient pressure was sustained; consider scheduling heavy runs off-peak or tightening quotas proactively.'
		);
	}

	if (relWall > 0 && extWall > 0 && relWall > extWall * 2.5 && relWall > 180_000) {
		bump('watch');
		recommendations.push(
			'Relations much slower than extraction on wall clock: large claim graphs benefit from lower RELATIONS_BATCH_TARGET_TOKENS and conservative concurrency.'
		);
	}

	if (recommendations.length === 0) {
		recommendations.push(
			'No strong pressure signals in telemetry — keep current posture; re-check after corpus or routing changes.'
		);
	}

	if (guardrails.length === 0) {
		guardrails.push(
			'Do not raise concurrency and batch targets together without monitoring 429/truncation; change one lever at a time and compare timingTelemetry across runs.'
		);
		guardrails.push(
			'Prefer offline fleet review (`pnpm ops:ingest-tuning-report-neon`) before shipping default env changes to production workers.'
		);
	}

	return { version: 1, severity, recommendations, guardrails, signals };
}
