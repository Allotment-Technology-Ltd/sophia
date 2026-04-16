/**
 * Stage 1 (Claim Extraction) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { PassageRecord, ReviewState } from '../contracts.js';
import { coerceIngestDomainLabel } from '../../prompts/domainZod.js';
import type { PhaseOneClaim } from './types.js';

export function normalizeExtractionDomain(value: unknown): string {
	return coerceIngestDomainLabel(value);
}

export function normalizeExtractionClaimType(value: unknown): string {
	if (typeof value !== 'string') return 'premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	const typeMap: Record<string, string> = {
		thesis: 'thesis',
		premise: 'premise',
		objection: 'objection',
		counterargument: 'objection',
		counter_argument: 'objection',
		response: 'response',
		reply: 'response',
		rebuttal: 'response',
		definition: 'definition',
		thought_experiment: 'thought_experiment',
		thoughtexperiment: 'thought_experiment',
		empirical: 'empirical',
		methodological: 'methodological'
	};
	return typeMap[normalized] ?? 'premise';
}

export function normalizePositivePosition(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return 1;
	return Math.trunc(parsed);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fine-tuned / repair models often emit one claim as a bare `{...}` instead of `[{...}]`.
 * If it looks like one extraction row (`text` is a string), wrap as a one-element array.
 */
export function coerceExtractionPayloadToClaimArray(payload: unknown): unknown {
	if (Array.isArray(payload)) return payload;
	if (!isPlainRecord(payload)) return payload;
	if (typeof payload.text !== 'string') return payload;
	return [payload];
}

/** One extraction row: plain object with required `text` string (other fields validated by Zod). */
export function isExtractionClaimRow(item: unknown): item is Record<string, unknown> {
	if (!isPlainRecord(item)) return false;
	return typeof item.text === 'string';
}

export function normalizeExtractionPayload(payload: unknown, forcedDomain?: string): unknown {
	const payloadArray = coerceExtractionPayloadToClaimArray(payload);
	if (!Array.isArray(payloadArray)) return payloadArray;
	const claimRows = payloadArray.filter(isExtractionClaimRow);
	if (claimRows.length < payloadArray.length && payloadArray.length > 0) {
		const dropped = payloadArray.length - claimRows.length;
		console.warn(
			`  [WARN] Dropped ${dropped} malformed extraction array entr${dropped === 1 ? 'y' : 'ies'} (expected claim objects with string \`text\`, not bare strings or nulls).`
		);
	}
	const domainOverride = forcedDomain ? normalizeExtractionDomain(forcedDomain) : null;
	return claimRows.map((typed, index) => {
		const confidenceRaw = Number(typed.confidence ?? 0.8);
		const confidence = Number.isFinite(confidenceRaw)
			? Math.max(0, Math.min(1, confidenceRaw))
			: 0.8;
		return {
			...typed,
			claim_type: normalizeExtractionClaimType(typed.claim_type),
			domain: domainOverride ?? normalizeExtractionDomain(typed.domain),
			position_in_source: normalizePositivePosition(typed.position_in_source ?? index + 1),
			confidence
		};
	});
}

export function reviewStateForConfidence(
	confidence: number,
	threshold: number
): ReviewState {
	return confidence < threshold ? 'needs_review' : 'candidate';
}

export function findFallbackPassage(
	claim: PhaseOneClaim,
	passages: PassageRecord[]
): PassageRecord | null {
	if (!claim.text || passages.length === 0) return null;

	const claimWords = new Set(
		claim.text
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 4)
	);
	if (claimWords.size === 0) return passages[0] ?? null;

	let bestPassage: PassageRecord | null = null;
	let bestOverlap = 0;

	for (const passage of passages) {
		const passageWords = new Set(
			passage.text
				.toLowerCase()
				.split(/\s+/)
				.filter((w) => w.length > 4)
		);
		let overlap = 0;
		for (const word of claimWords) {
			if (passageWords.has(word)) overlap++;
		}
		if (overlap > bestOverlap) {
			bestOverlap = overlap;
			bestPassage = passage;
		}
	}

	return bestPassage ?? passages[0] ?? null;
}

export function attachPassageMetadataToClaims(
	claims: PhaseOneClaim[],
	passages: PassageRecord[],
	extractorVersion: string,
	lowConfidenceThreshold: number
): PhaseOneClaim[] {
	const passageById = new Map(passages.map((p) => [p.id, p]));

	return claims.map((claim) => {
		let passage = claim.passage_id ? passageById.get(claim.passage_id) : undefined;
		if (!passage) {
			passage = findFallbackPassage(claim, passages) ?? undefined;
		}

		const reviewState = reviewStateForConfidence(claim.confidence, lowConfidenceThreshold);

		return {
			...claim,
			passage_id: passage?.id,
			passage_order: passage?.order_in_source,
			passage_role: passage?.role,
			source_span_start: passage?.span.start,
			source_span_end: passage?.span.end,
			review_state: reviewState,
			verification_state: 'unverified' as const,
			extractor_version: extractorVersion
		};
	});
}

export function normalizeSequentialClaimPositions(claims: PhaseOneClaim[]): PhaseOneClaim[] {
	return claims.map((claim, index) => ({
		...claim,
		position_in_source: index + 1
	}));
}

export function assertClaimIntegrity(claims: PhaseOneClaim[]): void {
	if (claims.length === 0) {
		throw new Error('[INTEGRITY] Extraction produced zero claims');
	}

	for (let i = 0; i < claims.length; i++) {
		const claim = claims[i];
		if (!claim.text || claim.text.trim().length === 0) {
			throw new Error(`[INTEGRITY] Claim at position ${i + 1} has empty text`);
		}
		if (!claim.claim_type) {
			throw new Error(`[INTEGRITY] Claim at position ${i + 1} has no claim_type`);
		}
		if (!claim.domain) {
			throw new Error(`[INTEGRITY] Claim at position ${i + 1} has no domain`);
		}
		if (
			!Number.isFinite(claim.confidence) ||
			claim.confidence < 0 ||
			claim.confidence > 1
		) {
			throw new Error(`[INTEGRITY] Claim at position ${i + 1} has invalid confidence: ${claim.confidence}`);
		}
	}
}

export function assertFiniteCostEstimate(totalUsd: number): void {
	if (!Number.isFinite(totalUsd)) {
		throw new Error(`[INTEGRITY] Cost estimate became non-finite: ${totalUsd}`);
	}
}

/**
 * On resume: ensure claims have full PhaseOneClaim shape (older checkpoints
 * may lack metadata fields added in later versions).
 */
export function ensurePhaseOneClaims(
	raw: PhaseOneClaim[],
	passages: PassageRecord[],
	extractorVersion: string,
	lowConfidenceThreshold: number
): PhaseOneClaim[] {
	const needsEnrichment = raw.some(
		(c) =>
			c.extractor_version === undefined ||
			c.review_state === undefined ||
			c.verification_state === undefined
	);
	if (!needsEnrichment) return raw;

	console.log('  [RESUME] Re-attaching passage metadata to resumed claims');
	return attachPassageMetadataToClaims(raw, passages, extractorVersion, lowConfidenceThreshold);
}
