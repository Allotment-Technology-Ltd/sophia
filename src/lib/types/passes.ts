import type { PhilosophicalDomain } from './domains';

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

export interface CritiquePass {
  weakest_premise: string;
  strongest_objection: string;
  overlooked_positions: string[];
  unsupported_claims: string[];
  contested_assumptions: string[];
  internal_tensions: string[];
}

export interface SynthesisPass {
  integrated_analysis: string;
  resolved_tensions: string[];
  unresolved_tensions: string[];
  epistemic_status: string;
  further_questions: string[];
  practical_implications: string[];
}

export interface VerificationClaim {
	claimId: string;
	grounded: boolean;
	supportingUris: string[];
	confidenceSignal: 'high' | 'medium' | 'low';
}

export interface VerificationPass {
	claims: VerificationClaim[];
	summary: string;
}

export type PassType = 'analysis' | 'critique' | 'synthesis' | 'verification';
