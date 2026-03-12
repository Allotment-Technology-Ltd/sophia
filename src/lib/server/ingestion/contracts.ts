import { z } from 'zod';

export const PASSAGE_ROLE_VALUES = [
	'thesis',
	'premise',
	'objection',
	'reply',
	'definition',
	'distinction',
	'example',
	'interpretive_commentary'
] as const;

export const CLAIM_ORIGIN_VALUES = [
	'source_grounded',
	'interpretive',
	'synthetic',
	'user_generated'
] as const;

export const REVIEW_STATE_VALUES = [
	'candidate',
	'accepted',
	'rejected',
	'merged',
	'needs_review'
] as const;

export const VERIFICATION_STATE_VALUES = ['unverified', 'validated', 'flagged'] as const;
export const RELATION_INFERENCE_MODE_VALUES = ['explicit', 'inferred'] as const;
export const CLAIM_SCOPE_VALUES = [
	'normative',
	'descriptive',
	'metaphilosophical',
	'empirical'
] as const;

export type PassageRole = (typeof PASSAGE_ROLE_VALUES)[number];
export type ClaimOrigin = (typeof CLAIM_ORIGIN_VALUES)[number];
export type ReviewState = (typeof REVIEW_STATE_VALUES)[number];
export type VerificationState = (typeof VERIFICATION_STATE_VALUES)[number];
export type RelationInferenceMode = (typeof RELATION_INFERENCE_MODE_VALUES)[number];
export type ClaimScope = (typeof CLAIM_SCOPE_VALUES)[number];

export const SourceSpanSchema = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative()
});

export const PassageRecordSchema = z.object({
	id: z.string(),
	order_in_source: z.number().int().positive(),
	section_title: z.string().nullable().optional(),
	text: z.string(),
	summary: z.string(),
	role: z.enum(PASSAGE_ROLE_VALUES),
	role_confidence: z.number().min(0).max(1),
	span: SourceSpanSchema
});

export type PassageRecord = z.infer<typeof PassageRecordSchema>;

export interface PhaseOneClaimMetadata {
	passage_id?: string;
	passage_order?: number;
	passage_role?: PassageRole;
	source_span_start?: number;
	source_span_end?: number;
	claim_origin: ClaimOrigin;
	subdomain?: string;
	thinker?: string;
	tradition?: string;
	era?: string;
	claim_scope: ClaimScope;
	attributed_to: string[];
	concept_tags: string[];
	verification_state: VerificationState;
	review_state: ReviewState;
	extractor_version: string;
	contested_terms: string[];
}

export interface PhaseOneRelationMetadata {
	evidence_passage_ids: string[];
	relation_confidence: number;
	relation_inference_mode: RelationInferenceMode;
	verification_state: VerificationState;
	review_state: ReviewState;
	extractor_version: string;
}
