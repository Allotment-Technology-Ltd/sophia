/**
 * Optional pre–Stage 3 heuristic: lower `GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS` when a single
 * mega-batch would likely exceed structured-output headroom (truncation → fallback → re-runs)
 * or when claim count is very high. Enabled by default in `scripts/ingest.ts`; set `INGEST_GROUPING_AUTO_TUNE=0` to disable.
 */

import type { PhaseOneClaim } from './stages/types.js';
import { splitClaimsIntoGroupingBatches } from './stages/grouping-helpers.js';
import { estimateTokens } from './stages/model-call.js';

export type ResolveGroupingAutoBatchTargetInput = {
	claims: PhaseOneClaim[];
	relationCount: number;
	/** From env / default (e.g. 72_000). */
	batchTargetFromEnv: number;
	tokenEstimateMultiplier: number;
	outputVsInputFactor: number;
	outputHeadroom: number;
	maxOutputTokens: number;
	autoTuneEnabled: boolean;
	/** Downgraded target when risk triggers (default 24_000 — matches BML sweet spot). */
	autoCapTokens?: number;
	/** Minimum batch target after downgrade. */
	minTargetTokens?: number;
	/** When the graph is still one batch at `batchTargetFromEnv` and claims ≥ this, cap (default 100). */
	largeClaimThreshold?: number;
};

export type ResolveGroupingAutoBatchTargetResult = {
	effectiveBatchTarget: number;
	/** Log line for console when auto-tune runs; `null` when disabled. */
	logLine: string | null;
};

export function resolveGroupingAutoBatchTarget(
	input: ResolveGroupingAutoBatchTargetInput
): ResolveGroupingAutoBatchTargetResult {
	const {
		claims,
		relationCount,
		batchTargetFromEnv,
		tokenEstimateMultiplier,
		outputVsInputFactor,
		outputHeadroom,
		maxOutputTokens,
		autoTuneEnabled
	} = input;

	const autoCap = input.autoCapTokens ?? 24_000;
	const minTarget = input.minTargetTokens ?? 8_000;
	const largeThreshold = input.largeClaimThreshold ?? 100;

	if (!autoTuneEnabled || claims.length <= 1) {
		return { effectiveBatchTarget: batchTargetFromEnv, logLine: null };
	}

	const claimsJson = JSON.stringify(claims, null, 2);
	const estStructuredOut = Math.ceil(estimateTokens(claimsJson) * outputVsInputFactor);
	const budget = Math.floor(maxOutputTokens * outputHeadroom);

	const preliminary = splitClaimsIntoGroupingBatches(
		claims,
		batchTargetFromEnv,
		tokenEstimateMultiplier
	);
	const singleAtEnvTarget = preliminary.length === 1;

	let effective = batchTargetFromEnv;
	const reasons: string[] = [];

	if (singleAtEnvTarget) {
		const overOutput = estStructuredOut > budget;
		const largeGraph = claims.length >= largeThreshold;
		if (overOutput || largeGraph) {
			effective = Math.min(effective, autoCap);
			if (overOutput) {
				reasons.push(
					`est. structured output ${estStructuredOut.toLocaleString()} tok > headroom ${budget.toLocaleString()} tok`
				);
			}
			if (largeGraph) {
				reasons.push(
					`${claims.length} claims / ${relationCount} rels in one batch at ${batchTargetFromEnv.toLocaleString()}-tok target — capping for stability`
				);
			}
		}
	}

	effective = Math.max(minTarget, effective);

	if (effective < batchTargetFromEnv) {
		return {
			effectiveBatchTarget: effective,
			logLine: `GROUPING_AUTO: batch target ${batchTargetFromEnv.toLocaleString()} → ${effective.toLocaleString()} — ${reasons.join('; ')}`
		};
	}

	return {
		effectiveBatchTarget: batchTargetFromEnv,
		logLine: null
	};
}
