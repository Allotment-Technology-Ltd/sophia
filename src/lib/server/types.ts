export type PhilosophicalDomain = 
  | 'ethics' 
  | 'applied_ethics' 
  | 'epistemology' 
  | 'metaphysics' 
  | 'philosophy_of_mind' 
  | 'political_philosophy' 
  | 'logic' 
  | 'aesthetics' 
  | 'philosophy_of_science' 
  | 'philosophy_of_language' 
  | 'philosophy_of_ai';

export interface Claim {
  id: string;
  text: string;
  claim_type: 'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'thought_experiment' | 'empirical' | 'methodological';
  domain: PhilosophicalDomain;
  source: string;
  confidence: number;
}

export interface AnalysisPass {
  domains_identified: PhilosophicalDomain[];
  positions_engaged: string[];
  core_argument: string;
  key_premises: string[];
  traditions_engaged: string[];
  confidence_notes: string[];
}

export interface CritiquePass {
  weakest_premise: string;
  strongest_objection: string;
  overlooked_positions: string[];
  unsupported_claims: string[];
  contested_assumptions: string[];
  gap_search_needed: boolean;
  gap_search_query?: string;
}

export interface SynthesisPass {
  integrated_analysis: string;
  resolved_tensions: string[];
  unresolved_tensions: string[];
  epistemic_status: string;
  further_questions: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  passes?: {
    analysis: string;
    critique: string;
    synthesis: string;
  };
}
