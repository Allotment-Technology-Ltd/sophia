/**
 * Optional pre–Stage 2 heuristic: lower `RELATIONS_BATCH_TARGET_TOKENS` on large claim graphs so
 * each relations call stays smaller — fewer mid-flight TPM/rate-limit splits and less wall time skew.
 * Enabled by default in `scripts/ingest.ts`; set `INGEST_RELATIONS_AUTO_TUNE=0` to disable.
 */

import type { PhaseOneClaim } from './stages/types.js';
import { buildRelationsBatches } from './stages/relations-helpers.js';
import { estimateTokens } from './stages/model-call.js';

export type ResolveRelationsAutoBatchTargetInput = {
	claims: PhaseOneClaim[];
	/** From env / default (e.g. 10_000). Use `0` when relations chunking is disabled. */
	batchTargetFromEnv: number;
	overlapClaims: number;
	autoTuneEnabled: boolean;
	/** Ceiling when auto downgrades (default 8_000 — below common 10k default to add batches). */
	autoCapTokens?: number;
	/** When claim count ≥ this, may cap to `autoCapTokens`. */
	largeClaimThreshold?: number;
	/** When total claim-JSON estimate (tokens) ≥ this, may cap. */
	largeTotalClaimJsonTokensThreshold?: number;
	minTargetTokens?: number;
};

export type ResolveRelationsAutoBatchTargetResult = {
	effectiveBatchTarget: number;
	logLine: string | null;
};

export function resolveRelationsAutoBatchTarget(
	input: ResolveRelationsAutoBatchTargetInput
): ResolveRelationsAutoBatchTargetResult {
	const { claims, batchTargetFromEnv, overlapClaims, autoTuneEnabled } = input;

	const autoCap = input.autoCapTokens ?? 8_000;
	const largeClaims = input.largeClaimThreshold ?? 80;
	const largeTotalTok = input.largeTotalClaimJsonTokensThreshold ?? 60_000;
	const minTarget = input.minTargetTokens ?? 4_000;

	if (batchTargetFromEnv <= 0 || !autoTuneEnabled || claims.length <= 1) {
		return { effectiveBatchTarget: batchTargetFromEnv, logLine: null };
	}

	const claimsJson = JSON.stringify(claims, null, 2);
	const totalClaimJsonTok = estimateTokens(claimsJson);

	const preliminary = buildRelationsBatches(claims, batchTargetFromEnv, overlapClaims);
	const batchCount = preliminary.length;
	const maxClaimsPerBatch = Math.max(...preliminary.map((b) => b.length), 0);

	const fewBatchesHeavy =
		batchCount <= 4 && claims.length >= 30 && maxClaimsPerBatch >= 25;

	const shouldCap =
		claims.length >= largeClaims ||
		totalClaimJsonTok >= largeTotalTok ||
		fewBatchesHeavy;

	if (!shouldCap) {
		return { effectiveBatchTarget: batchTargetFromEnv, logLine: null };
	}

	let effective = Math.min(batchTargetFromEnv, autoCap);
	effective = Math.max(minTarget, effective);

	if (effective >= batchTargetFromEnv) {
		return { effectiveBatchTarget: batchTargetFromEnv, logLine: null };
	}

	const reasons: string[] = [];
	if (claims.length >= largeClaims) {
		reasons.push(`${claims.length} claims`);
	}
	if (totalClaimJsonTok >= largeTotalTok) {
		reasons.push(`~${totalClaimJsonTok.toLocaleString()} tok claim JSON (est.)`);
	}
	if (fewBatchesHeavy) {
		reasons.push(
			`${batchCount} batch(es), up to ${maxClaimsPerBatch} claims/batch at ${batchTargetFromEnv.toLocaleString()}-tok target`
		);
	}

	return {
		effectiveBatchTarget: effective,
		logLine: `RELATIONS_AUTO: batch target ${batchTargetFromEnv.toLocaleString()} → ${effective.toLocaleString()} — ${reasons.join('; ')}`
	};
}
