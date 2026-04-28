/**
 * Stage 3 (Argument Grouping) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { GroupingOutput } from '$lib/server/prompts/grouping.js';
import type { PhaseOneClaim, PhaseOneRelation, GroupingBatch } from './types.js';
import { estimateTokens } from './model-call.js';

/**
 * Cheap pre-Stage-3 hints when the relation graph is empty or highly fragmented (often correlates
 * with grouping integrity / preempt-split churn). Does not throw — hard integrity is enforced
 * earlier by `assertClaimIntegrity` / `assertRelationIntegrity`.
 */
export function describePreGroupingGraphLint(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[]
): string[] {
	const warnings: string[] = [];
	if (claims.length === 0) return warnings;

	const positions = new Set(claims.map((c) => c.position_in_source));
	const degree = new Map<number, number>();
	for (const p of positions) degree.set(p, 0);
	for (const r of relations) {
		if (positions.has(r.from_position)) {
			degree.set(r.from_position, (degree.get(r.from_position) ?? 0) + 1);
		}
		if (positions.has(r.to_position)) {
			degree.set(r.to_position, (degree.get(r.to_position) ?? 0) + 1);
		}
	}
	let isolated = 0;
	for (const p of positions) {
		if ((degree.get(p) ?? 0) === 0) isolated += 1;
	}

	if (claims.length > 8 && relations.length === 0) {
		warnings.push(
			`pre-grouping: no Stage-2 relations for ${claims.length} claims — integrity retries are more likely; verify relations batching and source density.`
		);
	}

	const isolatedRatio = isolated / claims.length;
	if (claims.length >= 10 && isolatedRatio >= 0.65) {
		warnings.push(
			`pre-grouping: ${isolated}/${claims.length} claims (${Math.round(
				isolatedRatio * 100
			)}%) have no incident relation edges — graph is highly fragmented before argument grouping.`
		);
	}

	return warnings;
}

export function normalizeGroupingRole(value: unknown): string {
	if (typeof value !== 'string') return 'key_premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	const roleMap: Record<string, string> = {
		conclusion: 'conclusion',
		thesis: 'conclusion',
		key_premise: 'key_premise',
		main_premise: 'key_premise',
		supporting_premise: 'supporting_premise',
		minor_premise: 'supporting_premise',
		assumption: 'assumption',
		background_assumption: 'assumption',
		objection: 'objection',
		counterargument: 'objection',
		response: 'response',
		rebuttal: 'response',
		reply: 'response'
	};
	const direct = roleMap[normalized];
	if (direct) return direct;

	if (normalized.includes('conclusion') || normalized.includes('thesis')) return 'conclusion';
	if (normalized.includes('response') || normalized.includes('rebuttal') || normalized.includes('reply'))
		return 'response';
	if (normalized.includes('objection') || normalized.includes('counter')) return 'objection';
	if (normalized.includes('assumption')) return 'assumption';
	if (normalized.includes('supporting')) return 'supporting_premise';

	return 'key_premise';
}

/** If the model returned `{"named_arguments":[...]}`, unwrap to the array for downstream Zod. */
export function unwrapGroupingModelPayload(payload: unknown): unknown {
	if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
		const named = (payload as Record<string, unknown>).named_arguments;
		if (Array.isArray(named)) return named;
	}
	return payload;
}

/**
 * Normalise grouping JSON before Zod parse. **Invalid or missing `position_in_source` refs are dropped**
 * (not coerced to `1`), so malformed model output cannot collapse many claims onto position 1.
 * Accepts either a bare array or `{"named_arguments":[...]}` (see `unwrapGroupingModelPayload`).
 */
export function normalizeGroupingPayload(payload: unknown): unknown {
	const root = unwrapGroupingModelPayload(payload);
	if (!Array.isArray(root)) return root;
	return root.map((item) => {
		if (!item || typeof item !== 'object') return item;
		const typed = item as Record<string, unknown>;
		const claims = Array.isArray(typed.claims)
			? typed.claims.flatMap((claimRef: Record<string, unknown>) => {
					if (!claimRef || typeof claimRef !== 'object') return [];
					const raw = claimRef.position_in_source;
					const n = Number(raw);
					if (!Number.isFinite(n) || n < 1) return [];
					return [
						{
							...claimRef,
							role: normalizeGroupingRole(claimRef.role),
							position_in_source: Math.trunc(n)
						}
					];
				})
			: [];
		return { ...typed, claims };
	});
}

/**
 * Remove claim refs whose `position_in_source` is not in the current batch's claim set.
 * Prevents degenerate "collapsed" health signals when the model cites positions outside the batch excerpt.
 */
export function filterGroupingOutputToKnownClaimPositions(
	output: GroupingOutput,
	allowedPositions: ReadonlySet<number>
): GroupingOutput {
	const mapped = output.map((argument) => ({
		...argument,
		claims: argument.claims.filter((c) => allowedPositions.has(c.position_in_source))
	}));
	return mapped.filter((a) => a.claims.length > 0);
}

export function splitClaimsIntoGroupingBatches(
	claims: PhaseOneClaim[],
	targetTokens: number,
	tokenEstimateMultiplier: number
): PhaseOneClaim[][] {
	if (claims.length <= 1) return [claims];
	const estimatedTotalTokens = Math.ceil(
		estimateTokens(JSON.stringify(claims, null, 2)) * tokenEstimateMultiplier
	);
	if (estimatedTotalTokens <= targetTokens) return [claims];

	const batches: PhaseOneClaim[][] = [];
	let currentBatch: PhaseOneClaim[] = [];
	let currentBatchTokens = 0;

	for (const claim of claims) {
		const claimTokens = Math.ceil(
			estimateTokens(JSON.stringify(claim, null, 2)) * tokenEstimateMultiplier
		);
		const wouldExceed =
			currentBatch.length > 0 && currentBatchTokens + claimTokens > targetTokens;
		if (wouldExceed) {
			batches.push(currentBatch);
			currentBatch = [claim];
			currentBatchTokens = claimTokens;
			continue;
		}

		currentBatch.push(claim);
		currentBatchTokens += claimTokens;
	}

	if (currentBatch.length > 0) {
		batches.push(currentBatch);
	}

	return batches.length > 0 ? batches : [claims];
}

export function buildGroupingBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	targetTokens: number,
	tokenEstimateMultiplier: number
): GroupingBatch[] {
	const claimBatches = splitClaimsIntoGroupingBatches(
		claims,
		targetTokens,
		tokenEstimateMultiplier
	);
	return claimBatches.map((batchClaims) => {
		const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
		const batchRelations = relations.filter(
			(relation) =>
				claimPositions.has(relation.from_position) &&
				claimPositions.has(relation.to_position)
		);
		return {
			claims: batchClaims,
			relations: batchRelations
		};
	});
}

export function mergeGroupingOutputs(outputs: GroupingOutput[]): GroupingOutput {
	const merged = new Map<string, GroupingOutput[number]>();

	for (const output of outputs) {
		for (const argument of output) {
			const key = `${argument.name.trim().toLowerCase()}::${argument.domain}`;
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, {
					...argument,
					claims: [...argument.claims]
				});
				continue;
			}

			const claimRefs = new Map<
				string,
				GroupingOutput[number]['claims'][number]
			>();
			for (const claimRef of existing.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}
			for (const claimRef of argument.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}

			existing.claims = Array.from(claimRefs.values()).sort(
				(a, b) => a.position_in_source - b.position_in_source
			);
			if (!existing.tradition && argument.tradition) {
				existing.tradition = argument.tradition;
			}
			if (
				(!existing.summary || existing.summary.trim().length === 0) &&
				argument.summary
			) {
				existing.summary = argument.summary;
			}
		}
	}

	return Array.from(merged.values());
}

export function analyzeGroupingReferenceHealth(arguments_: GroupingOutput): {
	totalReferences: number;
	uniquePositions: number;
	positionOneReferences: number;
	positionOneShare: number;
	collapsed: boolean;
} {
	const positions: number[] = [];
	for (const argument of arguments_) {
		for (const claimRef of argument.claims) {
			positions.push(claimRef.position_in_source);
		}
	}
	const totalReferences = positions.length;
	const uniquePositions = new Set(positions).size;
	const positionOneReferences = positions.filter((position) => position === 1).length;
	const positionOneShare =
		totalReferences > 0 ? positionOneReferences / totalReferences : 0;
	const collapsed =
		totalReferences >= 20 &&
		(uniquePositions <= 3 ||
			(positionOneShare >= 0.8 && positionOneReferences >= 20));
	return {
		totalReferences,
		uniquePositions,
		positionOneReferences,
		positionOneShare,
		collapsed
	};
}

export function analyzeGroupingDegeneration(
	arguments_: GroupingOutput,
	options?: {
		/** Hard cap to prevent "everything is an objection" / giant argument blobs. */
		maxClaimRefsPerArgument?: number;
		/** If true, require exactly one conclusion per argument when refs are non-trivial. */
		requireSingleConclusion?: boolean;
	}
): { degenerate: boolean; reasons: string[] } {
	const maxClaimRefsPerArgument = Math.max(6, options?.maxClaimRefsPerArgument ?? 30);
	const requireSingleConclusion = options?.requireSingleConclusion ?? true;
	const reasons: string[] = [];

	for (const arg of arguments_) {
		const refs = Array.isArray(arg.claims) ? arg.claims : [];
		if (refs.length > maxClaimRefsPerArgument) {
			reasons.push(
				`argument "${arg.name}" has ${refs.length} claim refs (cap ${maxClaimRefsPerArgument})`
			);
		}

		const byRole = new Map<string, number>();
		for (const r of refs) {
			const role = (r as { role?: string }).role ?? 'key_premise';
			byRole.set(role, (byRole.get(role) ?? 0) + 1);
		}
		const conclusions = byRole.get('conclusion') ?? 0;
		if (requireSingleConclusion && refs.length >= 3 && conclusions !== 1) {
			reasons.push(
				`argument "${arg.name}" has conclusion_count=${conclusions} (expected exactly 1)`
			);
		}

		const objections = byRole.get('objection') ?? 0;
		if (refs.length >= 12 && objections / refs.length >= 0.8) {
			reasons.push(
				`argument "${arg.name}" is objection-heavy (${objections}/${refs.length} objections)`
			);
		}
	}

	return { degenerate: reasons.length > 0, reasons };
}
