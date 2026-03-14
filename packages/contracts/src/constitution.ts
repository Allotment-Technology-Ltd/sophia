import { z } from 'zod';
import { VerificationClaimTypeSchema, type VerificationClaimType } from './verification';

export type ClaimType = VerificationClaimType;

export const SeveritySchema = z.enum(['critical', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

export const RuleStatusSchema = z.enum(['satisfied', 'violated', 'uncertain', 'not_applicable']);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const ConstitutionRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  applies_to: z.array(VerificationClaimTypeSchema),
  severity: SeveritySchema,
  deterministic_check: z.boolean().optional()
});

export type ConstitutionRule = z.infer<typeof ConstitutionRuleSchema>;

export const RuleEvaluationSchema = z.object({
  rule_id: z.string().min(1),
  rule_name: z.string().min(1),
  status: RuleStatusSchema,
  severity: SeveritySchema,
  affected_claim_ids: z.array(z.string()),
  rationale: z.string().min(1),
  remediation: z.string().min(1).optional()
});

export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;

export const ConstitutionalCheckSchema = z.object({
  rules_evaluated: z.number().int().min(0),
  satisfied: z.array(RuleEvaluationSchema),
  violated: z.array(RuleEvaluationSchema),
  uncertain: z.array(RuleEvaluationSchema),
  not_applicable: z.array(RuleEvaluationSchema),
  overall_compliance: z.enum(['pass', 'partial', 'fail'])
});

export type ConstitutionalCheck = z.infer<typeof ConstitutionalCheckSchema>;
