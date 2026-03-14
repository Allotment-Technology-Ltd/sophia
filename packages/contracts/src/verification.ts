import { z } from 'zod';
import type { ConstitutionalCheck } from './constitution';

export const VerificationClaimTypeSchema = z.enum([
  'empirical',
  'causal',
  'explanatory',
  'normative',
  'predictive',
  'definitional',
  'procedural'
]);

export type VerificationClaimType = z.infer<typeof VerificationClaimTypeSchema>;

export const VerificationClaimScopeSchema = z.enum(['narrow', 'moderate', 'broad', 'universal']);

export type VerificationClaimScope = z.infer<typeof VerificationClaimScopeSchema>;

export const VerificationRelationTypeSchema = z.enum([
  'supports',
  'contradicts',
  'depends_on',
  'responds_to',
  'defines',
  'qualifies'
]);

export type VerificationRelationType = z.infer<typeof VerificationRelationTypeSchema>;

export const ExtractedClaimSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  claim_type: VerificationClaimTypeSchema,
  scope: VerificationClaimScopeSchema,
  confidence: z.number().min(0).max(1),
  source_span: z.string().optional(),
  source_span_start: z.number().int().min(0).optional(),
  source_span_end: z.number().int().min(0).optional()
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export const ExtractedRelationSchema = z.object({
  from_claim_id: z.string(),
  to_claim_id: z.string(),
  relation_type: VerificationRelationTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1)
});

export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;

export const VerificationTokensSchema = z.object({
  input: z.number().int().min(0),
  output: z.number().int().min(0)
});

export const ExtractionMetadataSchema = z.object({
  source_length: z.number().int().min(0),
  extraction_model: z.string(),
  extraction_duration_ms: z.number().int().min(0),
  tokens_used: VerificationTokensSchema
});

export const ExtractionResultSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
  relations: z.array(ExtractedRelationSchema),
  metadata: ExtractionMetadataSchema
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const VerificationRequestSchema = z
  .object({
    question: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    domain_hint: z.string().min(1).optional(),
    depth: z.enum(['quick', 'standard', 'deep']).optional()
  })
  .refine((data) => Boolean(data.text?.trim() || data.answer?.trim()), {
    message: 'Provide at least one of `text` or `answer`.'
  });

export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;

export const ReasoningDimensionSchema = z.enum([
  'logical_structure',
  'evidence_grounding',
  'counterargument_coverage',
  'scope_calibration',
  'assumption_transparency',
  'internal_consistency'
]);

export type ReasoningDimension = z.infer<typeof ReasoningDimensionSchema>;

export const ReasoningScoreSchema = z.object({
  dimension: ReasoningDimensionSchema,
  score: z.number().min(0).max(1),
  explanation: z.string().min(1),
  flagged_claims: z.array(z.string()).optional()
});

export type ReasoningScore = z.infer<typeof ReasoningScoreSchema>;

export const ReasoningEvaluationSchema = z.object({
  overall_score: z.number().min(0).max(1),
  dimensions: z.array(ReasoningScoreSchema).length(6)
});

export type ReasoningEvaluation = z.infer<typeof ReasoningEvaluationSchema>;

export interface VerificationResult {
  request_id: string;
  extracted_claims: ExtractedClaim[];
  logical_relations: ExtractedRelation[];
  reasoning_quality: ReasoningEvaluation;
  constitutional_check: ConstitutionalCheck;
  pass_outputs?: {
    analysis?: string;
    critique?: string;
    synthesis?: string;
  };
  metadata: {
    processing_time_ms: number;
    constitution_duration_ms?: number;
    constitution_input_tokens?: number;
    constitution_output_tokens?: number;
    constitution_rule_violations?: string[];
    input_length: number;
    model: string;
    retrieval?: {
      claims_retrieved?: number;
      arguments_retrieved?: number;
      retrieval_degraded?: boolean;
      retrieval_degraded_reason?: string;
      detected_domain?: string;
      domain_confidence?: 'high' | 'medium' | 'low';
    };
    tokens_used?: {
      extraction_input: number;
      extraction_output: number;
    };
  };
}
