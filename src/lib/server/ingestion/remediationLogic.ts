import type { ValidationOutput } from '$lib/server/prompts/validation.js';
import type { Relation } from '$lib/server/prompts/relations.js';

export function sliceSourceAroundClaim(
	sourceText: string,
	spanStart: number | undefined,
	spanEnd: number | undefined,
	opts?: { maxChars?: number; pad?: number }
): string {
	const maxChars = opts?.maxChars ?? 12_000;
	const pad = opts?.pad ?? 400;
	if (typeof spanStart !== 'number' || typeof spanEnd !== 'number' || spanEnd < spanStart) {
		return sourceText.slice(0, Math.min(maxChars, sourceText.length));
	}
	const lo = Math.max(0, spanStart - pad);
	const hi = Math.min(sourceText.length, spanEnd + pad);
	let excerpt = sourceText.slice(lo, hi);
	if (excerpt.length > maxChars) {
		excerpt = excerpt.slice(0, maxChars);
	}
	return excerpt;
}

export function selectRemediationPositions(
	validation: ValidationOutput | null | undefined,
	opts: { faithfulnessMin: number; maxClaims: number }
): number[] {
	if (!validation?.claims?.length) return [];
	const out: number[] = [];
	for (const c of validation.claims) {
		const pos = c.position_in_source;
		if (typeof pos !== 'number' || !Number.isFinite(pos)) continue;
		if (c.quarantine === true || c.faithfulness_score < opts.faithfulnessMin) {
			out.push(pos);
		}
	}
	const unique = [...new Set(out)].sort((a, b) => a - b);
	return unique.slice(0, opts.maxClaims);
}

export function relationEdgeKey(from: number, to: number): string {
	return `${from}->${to}`;
}

/**
 * Drop relations validation marked quarantine, or with validity_score below threshold.
 */
export function dropRelationsByValidation(
	relations: Relation[],
	validation: ValidationOutput | null | undefined,
	validityMin: number
): Relation[] {
	if (!validation?.relations?.length) return relations;
	const drop = new Set<string>();
	for (const r of validation.relations) {
		const key = relationEdgeKey(r.from_position, r.to_position);
		if (r.quarantine === true || r.validity_score < validityMin) {
			drop.add(key);
		}
	}
	if (drop.size === 0) return relations;
	return relations.filter((rel) => !drop.has(relationEdgeKey(rel.from_position, rel.to_position)));
}

export function shouldRerunRelationsAfterRemediation(params: {
	remediatedPositions: Set<number>;
	droppedRelationCount: number;
	claimCount: number;
	forceEnv: boolean;
	remediatedShareThreshold: number;
}): boolean {
	if (params.forceEnv) return true;
	if (params.droppedRelationCount > 0) return true;
	if (params.claimCount <= 0) return false;
	const share = params.remediatedPositions.size / params.claimCount;
	return share >= params.remediatedShareThreshold;
}

/** Re-run only validation batches that include at least one remediated claim position. */
export function filterValidationBatchesTouchingClaimPositions<
	T extends { claims: readonly { position_in_source: number }[] }
>(batches: readonly T[], remediatedPositions: ReadonlySet<number>): T[] {
	if (remediatedPositions.size === 0) return [];
	return batches.filter((b) =>
		b.claims.some((c) => remediatedPositions.has(c.position_in_source))
	);
}
