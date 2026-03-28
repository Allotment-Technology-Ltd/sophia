/**
 * Stage 2 (Relation Extraction) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { PhaseOneClaim, PhaseOneRelation } from './types.js';
import type { ReviewState } from '../contracts.js';
import { estimateTokens } from './model-call.js';

export function relationConfidenceFromStrength(strength?: string): number {
	if (strength === 'strong') return 0.9;
	if (strength === 'weak') return 0.58;
	return 0.74;
}

export function attachRelationMetadata(
	relations: PhaseOneRelation[],
	lowConfidenceThreshold: number,
	extractorVersion: string
): PhaseOneRelation[] {
	return relations.map((r) => ({
		...r,
		relation_confidence: r.relation_confidence ?? relationConfidenceFromStrength(r.strength),
		relation_inference_mode: r.relation_inference_mode ?? ('inferred' as const),
		evidence_passage_ids: r.evidence_passage_ids ?? [],
		review_state: (
			(r.relation_confidence ?? relationConfidenceFromStrength(r.strength)) < lowConfidenceThreshold
				? 'needs_review'
				: 'candidate'
		) as ReviewState,
		verification_state: 'unverified' as const,
		extractor_version: extractorVersion
	}));
}

export function buildRelationsBatches(
	claims: PhaseOneClaim[],
	targetTokens: number,
	overlapClaims: number
): PhaseOneClaim[][] {
	if (targetTokens <= 0 || claims.length <= 1) return [claims];

	const overlap = Math.max(0, Math.min(overlapClaims, claims.length - 1));
	const tokensPerClaim = claims.map((claim) =>
		Math.ceil(estimateTokens(JSON.stringify(claim, null, 2)))
	);
	const batches: PhaseOneClaim[][] = [];

	let start = 0;
	while (start < claims.length) {
		let tokens = 0;
		let end = start;

		while (end < claims.length) {
			const claimTokens = tokensPerClaim[end] ?? 0;
			const wouldExceed = end > start && tokens + claimTokens > targetTokens;
			if (wouldExceed) break;
			tokens += claimTokens;
			end += 1;
		}

		if (end === start) end = start + 1;

		batches.push(claims.slice(start, end));

		if (end >= claims.length) break;
		const nextStart = Math.max(end - overlap, start + 1);
		start = nextStart;
	}

	return batches.length > 0 ? batches : [claims];
}

export function relationDedupeKey(relation: PhaseOneRelation): string {
	return `${relation.from_position}:${relation.to_position}:${relation.relation_type}`;
}

export function mergeRelationsDedup(
	existing: PhaseOneRelation[],
	incoming: PhaseOneRelation[]
): PhaseOneRelation[] {
	const merged = new Map<string, PhaseOneRelation>();

	for (const r of existing) {
		merged.set(relationDedupeKey(r), {
			...r,
			evidence_passage_ids: [...new Set(r.evidence_passage_ids)]
		});
	}

	for (const r of incoming) {
		const key = relationDedupeKey(r);
		const prev = merged.get(key);
		if (!prev) {
			merged.set(key, {
				...r,
				evidence_passage_ids: [...new Set(r.evidence_passage_ids)]
			});
			continue;
		}

		const evidence_passage_ids = [
			...new Set([...(prev.evidence_passage_ids ?? []), ...(r.evidence_passage_ids ?? [])])
		];
		const prevHasNote = typeof prev.note === 'string' && prev.note.trim().length > 0;
		const nextHasNote = typeof r.note === 'string' && r.note.trim().length > 0;

		const pickHigher =
			(r.relation_confidence ?? 0) > (prev.relation_confidence ?? 0) ? r : prev;
		const other = pickHigher === r ? prev : r;

		merged.set(key, {
			...pickHigher,
			evidence_passage_ids,
			note:
				typeof pickHigher.note === 'string' && pickHigher.note.trim().length > 0
					? pickHigher.note
					: nextHasNote && !prevHasNote
						? other.note
						: pickHigher.note
		});
	}

	return Array.from(merged.values()).sort((a, b) => {
		if (a.from_position !== b.from_position) return a.from_position - b.from_position;
		if (a.to_position !== b.to_position) return a.to_position - b.to_position;
		return a.relation_type.localeCompare(b.relation_type);
	});
}

export function assertRelationIntegrity(
	relations: PhaseOneRelation[],
	maxClaimPosition: number
): void {
	for (const r of relations) {
		if (r.from_position < 1 || r.from_position > maxClaimPosition) {
			throw new Error(
				`[INTEGRITY] Relation from_position ${r.from_position} out of range [1, ${maxClaimPosition}]`
			);
		}
		if (r.to_position < 1 || r.to_position > maxClaimPosition) {
			throw new Error(
				`[INTEGRITY] Relation to_position ${r.to_position} out of range [1, ${maxClaimPosition}]`
			);
		}
		if (r.from_position === r.to_position) {
			throw new Error(
				`[INTEGRITY] Self-referencing relation at position ${r.from_position}`
			);
		}
	}
}
