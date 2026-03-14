import { z } from 'zod';

export const AnalysisPhaseSchema = z.enum(['analysis', 'critique', 'synthesis']);

export type AnalysisPhase = z.infer<typeof AnalysisPhaseSchema>;

export const BadgeVariantSchema = z.enum([
  'thesis',
  'premise',
  'objection',
  'response',
  'definition',
  'empirical'
]);

export type BadgeVariant = z.infer<typeof BadgeVariantSchema>;

export const RelationTypeSchema = z.enum([
  'supports',
  'contradicts',
  'responds-to',
  'depends-on',
  'defines',
  'qualifies',
  'assumes',
  'resolves'
]);

export type RelationType = z.infer<typeof RelationTypeSchema>;

export const ClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  badge: BadgeVariantSchema,
  source: z.string().min(1),
  tradition: z.string().min(1),
  detail: z.string().min(1),
  phase: AnalysisPhaseSchema,
  backRefIds: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceUrl: z.string().url().optional()
});

export type Claim = z.infer<typeof ClaimSchema>;

export const RelationBundleSchema = z.object({
  claimId: z.string().min(1),
  relations: z.array(
    z.object({
      type: RelationTypeSchema,
      target: z.string().min(1),
      label: z.string().min(1)
    })
  )
});

export type RelationBundle = z.infer<typeof RelationBundleSchema>;

export const SourceReferenceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.array(z.string().min(1)),
  claimCount: z.number().int().min(0),
  groundingConfidence: z
    .object({
      score: z.number().min(0).max(1),
      supportingUris: z.array(z.string().min(1))
    })
    .optional()
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;
