/**
 * Stage 3 (Argument Grouping) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { GroupingOutput } from '$lib/server/prompts/grouping.js';
import type { PhaseOneClaim, PhaseOneRelation, GroupingBatch } from './types.js';
import { estimateTokens } from './model-call.js';

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

export function normalizeGroupingPayload(
	payload: unknown,
	normalizePositivePosition: (v: unknown) => number
): unknown {
	if (!Array.isArray(payload)) return payload;
	return payload.map((item) => {
		if (!item || typeof item !== 'object') return item;
		const typed = item as Record<string, unknown>;
		const claims = Array.isArray(typed.claims)
			? typed.claims.map((claimRef: Record<string, unknown>) => ({
					...claimRef,
					role: normalizeGroupingRole(claimRef?.role),
					position_in_source: normalizePositivePosition(claimRef?.position_in_source ?? 1)
				}))
			: [];
		return { ...typed, claims };
	});
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
