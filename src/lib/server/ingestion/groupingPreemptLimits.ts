/**
 * Stage 3 preempt splits before the first model call: avoid max_output truncation and
 * reduce wall-clock timeouts on dense sources (e.g. SEP: many short claims still fit a token budget).
 *
 * Env: `INGEST_GROUPING_MAX_CLAIMS_PER_BATCH`
 * - unset → default cap (see `DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH`)
 * - `0` | `unlimited` | `off` | `none` → no claim-count split (output headroom logic only)
 * - positive integer → hard cap
 */

import type { GroupingBatch } from './stages/types.js';
import { estimateTokens } from './stages/model-call.js';

/** Default when `INGEST_GROUPING_MAX_CLAIMS_PER_BATCH` is unset — dense sources can pack many short claims under a token cap. */
export const DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH = 72;

export function estimateGroupingStructuredOutputTokens(
	batch: GroupingBatch,
	outputVsInputFactor: number
): number {
	const claimsJson = JSON.stringify(batch.claims, null, 2);
	return Math.ceil(estimateTokens(claimsJson) * outputVsInputFactor);
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.trunc(parsed);
}

/**
 * Max claims per grouping batch for preempt splitting. `undefined` = no claim-based limit.
 */
export function resolveGroupingPreemptMaxClaimsPerBatch(
	env: NodeJS.ProcessEnv = process.env
): number | undefined {
	const raw = env.INGEST_GROUPING_MAX_CLAIMS_PER_BATCH?.trim();
	if (raw === undefined || raw === '') {
		return DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH;
	}
	const lower = raw.toLowerCase();
	if (lower === '0' || lower === 'unlimited' || lower === 'off' || lower === 'none') {
		return undefined;
	}
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) {
		return DEFAULT_GROUPING_PREEMPT_MAX_CLAIMS_PER_BATCH;
	}
	if (n === 0) return undefined;
	return Math.max(1, Math.trunc(n));
}

export type GroupingPreemptReason = 'claims' | 'output';

export function groupingBatchPreemptReason(args: {
	batch: GroupingBatch;
	maxOutputTokens: number;
	outputHeadroomFraction: number;
	outputVsInputFactor: number;
	maxClaims: number | undefined;
}): GroupingPreemptReason | null {
	const { batch, maxOutputTokens, outputHeadroomFraction, outputVsInputFactor, maxClaims } = args;
	if (maxClaims != null && batch.claims.length > maxClaims) {
		return 'claims';
	}
	const estOut = estimateGroupingStructuredOutputTokens(batch, outputVsInputFactor);
	if (estOut > Math.floor(maxOutputTokens * outputHeadroomFraction)) {
		return 'output';
	}
	return null;
}
