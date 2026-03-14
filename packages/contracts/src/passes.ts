import { z } from 'zod';
import { PhilosophicalDomainSchema, type PhilosophicalDomain } from './domains';

export const PassTypeSchema = z.enum(['analysis', 'critique', 'synthesis', 'verification']);

export type PassType = z.infer<typeof PassTypeSchema>;

export const AnalysisPassSchema = z.object({
  domains_identified: z.array(PhilosophicalDomainSchema),
  core_question: z.string().min(1),
  positions: z.array(
    z.object({
      name: z.string().min(1),
      tradition: z.string().min(1),
      key_thinkers: z.array(z.string().min(1)),
      core_argument: z.string().min(1),
      key_premises: z.array(z.string().min(1))
    })
  ),
  traditions_engaged: z.array(z.string().min(1)),
  confidence_notes: z.array(z.string().min(1))
});

export interface AnalysisPass {
  domains_identified: PhilosophicalDomain[];
  core_question: string;
  positions: Array<{
    name: string;
    tradition: string;
    key_thinkers: string[];
    core_argument: string;
    key_premises: string[];
  }>;
  traditions_engaged: string[];
  confidence_notes: string[];
}

export const CritiquePassSchema = z.object({
  weakest_premise: z.string().min(1),
  strongest_objection: z.string().min(1),
  overlooked_positions: z.array(z.string().min(1)),
  unsupported_claims: z.array(z.string().min(1)),
  contested_assumptions: z.array(z.string().min(1)),
  internal_tensions: z.array(z.string().min(1))
});

export type CritiquePass = z.infer<typeof CritiquePassSchema>;

export const SynthesisPassSchema = z.object({
  integrated_analysis: z.string().min(1),
  resolved_tensions: z.array(z.string().min(1)),
  unresolved_tensions: z.array(z.string().min(1)),
  epistemic_status: z.string().min(1),
  further_questions: z.array(z.string().min(1)),
  practical_implications: z.array(z.string().min(1))
});

export type SynthesisPass = z.infer<typeof SynthesisPassSchema>;

export const VerificationClaimSchema = z.object({
  claimId: z.string().min(1),
  grounded: z.boolean(),
  supportingUris: z.array(z.string().min(1)),
  confidenceSignal: z.enum(['high', 'medium', 'low'])
});

export type VerificationClaim = z.infer<typeof VerificationClaimSchema>;

export const VerificationPassSchema = z.object({
  claims: z.array(VerificationClaimSchema),
  summary: z.string().min(1)
});

export type VerificationPass = z.infer<typeof VerificationPassSchema>;
