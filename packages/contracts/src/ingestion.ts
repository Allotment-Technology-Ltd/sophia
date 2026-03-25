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

export const PassageRoleSchema = z.enum(PASSAGE_ROLE_VALUES);
export const ClaimOriginSchema = z.enum(CLAIM_ORIGIN_VALUES);
export const ReviewStateSchema = z.enum(REVIEW_STATE_VALUES);
export const VerificationStateSchema = z.enum(VERIFICATION_STATE_VALUES);
export const RelationInferenceModeSchema = z.enum(RELATION_INFERENCE_MODE_VALUES);
export const ClaimScopeSchema = z.enum(CLAIM_SCOPE_VALUES);

export type PassageRole = z.infer<typeof PassageRoleSchema>;
export type ClaimOrigin = z.infer<typeof ClaimOriginSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type VerificationState = z.infer<typeof VerificationStateSchema>;
export type RelationInferenceMode = z.infer<typeof RelationInferenceModeSchema>;
export type ClaimScope = z.infer<typeof ClaimScopeSchema>;

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
  role: PassageRoleSchema,
  role_confidence: z.number().min(0).max(1),
  span: SourceSpanSchema
});

export type PassageRecord = z.infer<typeof PassageRecordSchema>;

/** JSON from models often uses `null` for absent optional strings. */
function nullishOptionalString(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  return value;
}

export const PhaseOneClaimMetadataSchema = z.object({
  passage_id: z.string().min(1).optional(),
  passage_order: z.number().int().positive().optional(),
  passage_role: PassageRoleSchema.optional(),
  source_span_start: z.number().int().nonnegative().optional(),
  source_span_end: z.number().int().nonnegative().optional(),
  claim_origin: ClaimOriginSchema,
  subdomain: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
  thinker: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
  tradition: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
  era: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
  claim_scope: ClaimScopeSchema,
  attributed_to: z.array(z.string().min(1)),
  concept_tags: z.array(z.string().min(1)),
  verification_state: VerificationStateSchema,
  review_state: ReviewStateSchema,
  extractor_version: z.string().min(1),
  contested_terms: z.array(z.string().min(1))
});

export type PhaseOneClaimMetadata = z.infer<typeof PhaseOneClaimMetadataSchema>;

export const PhaseOneRelationMetadataSchema = z.object({
  evidence_passage_ids: z.array(z.string().min(1)),
  relation_confidence: z.number().min(0).max(1),
  relation_inference_mode: RelationInferenceModeSchema,
  verification_state: VerificationStateSchema,
  review_state: ReviewStateSchema,
  extractor_version: z.string().min(1)
});

export type PhaseOneRelationMetadata = z.infer<typeof PhaseOneRelationMetadataSchema>;
