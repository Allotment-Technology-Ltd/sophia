import { z } from 'zod';
import {
	DUPLICATE_CLASSIFICATIONS,
	REVIEWABLE_RELATION_TABLES,
	type DuplicateClassification,
	type ReviewableRelationTable
} from '$lib/server/review/workflow';
import type { ReviewState } from '@restormel/contracts/ingestion';

export const REVIEW_STATE_OPTIONS = [
	'accepted',
	'rejected',
	'needs_review',
	'candidate'
] as const satisfies readonly Exclude<ReviewState, 'merged'>[];

export type ReviewDecisionState = (typeof REVIEW_STATE_OPTIONS)[number];

export const ReviewClaimDecisionSchema = z.object({
	claim_id: z.string().min(1),
	next_state: z.enum(REVIEW_STATE_OPTIONS),
	notes: z.string().max(2000).optional().default('')
});

export const ReviewRelationDecisionSchema = z.object({
	relation_id: z.string().min(1),
	relation_table: z.enum(REVIEWABLE_RELATION_TABLES),
	next_state: z.enum(REVIEW_STATE_OPTIONS),
	notes: z.string().max(2000).optional().default('')
});

export const ResolveDuplicateSchema = z.object({
	left_claim_id: z.string().min(1),
	right_claim_id: z.string().min(1),
	canonical_claim_id: z.string().min(1).optional(),
	classification: z.enum(DUPLICATE_CLASSIFICATIONS),
	notes: z.string().max(2000).optional().default('')
});

export function isReviewableRelationTable(value: string): value is ReviewableRelationTable {
	return REVIEWABLE_RELATION_TABLES.includes(value as ReviewableRelationTable);
}

export function isDuplicateClassification(value: string): value is DuplicateClassification {
	return DUPLICATE_CLASSIFICATIONS.includes(value as DuplicateClassification);
}
