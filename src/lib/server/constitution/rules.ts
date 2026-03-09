import type { ClaimType, ConstitutionRule } from '$lib/types/constitution';

const ALL_CLAIM_TYPES: ClaimType[] = [
  'empirical',
  'causal',
  'explanatory',
  'normative',
  'predictive',
  'definitional',
  'procedural'
];

export const EPISTEMIC_RULES: ConstitutionRule[] = [
  {
    id: 'evidence_requirement',
    name: 'Evidence Requirement',
    description:
      'A factual or empirical claim must have at least one supporting evidence passage or citation.',
    applies_to: ['empirical', 'causal', 'predictive'],
    severity: 'critical',
    deterministic_check: true
  },
  {
    id: 'proportional_evidence',
    name: 'Proportional Evidence',
    description:
      'The strength of a claim must be proportional to the quality and amount of evidence.',
    applies_to: ['empirical', 'causal', 'predictive'],
    severity: 'warning',
    deterministic_check: true
  },
  {
    id: 'contradiction_awareness',
    name: 'Contradiction Awareness',
    description: 'Reasoning must acknowledge credible contradicting evidence when present.',
    applies_to: ['empirical', 'causal', 'explanatory', 'normative'],
    severity: 'critical',
    deterministic_check: true
  },
  {
    id: 'alternative_hypotheses',
    name: 'Alternative Hypotheses',
    description:
      'Causal or explanatory claims should consider plausible alternative explanations.',
    applies_to: ['causal', 'explanatory'],
    severity: 'warning',
    deterministic_check: false
  },
  {
    id: 'scope_discipline',
    name: 'Scope Discipline',
    description: 'Claims must not exceed the scope of their evidence.',
    applies_to: ['empirical', 'causal', 'predictive'],
    severity: 'critical',
    deterministic_check: true
  },
  {
    id: 'assumption_transparency',
    name: 'Assumption Transparency',
    description:
      'Key hidden assumptions should be surfaced when they materially affect the conclusion.',
    applies_to: ALL_CLAIM_TYPES,
    severity: 'warning',
    deterministic_check: false
  },
  {
    id: 'correlation_vs_causation',
    name: 'Correlation vs Causation',
    description:
      'Correlational evidence must not be presented as decisive causal proof.',
    applies_to: ['causal'],
    severity: 'critical',
    deterministic_check: true
  },
  {
    id: 'uncertainty_signalling',
    name: 'Uncertainty Signalling',
    description: 'Weak or mixed evidence should be reflected in the synthesis tone.',
    applies_to: ALL_CLAIM_TYPES,
    severity: 'warning',
    deterministic_check: false
  },
  {
    id: 'normative_bridge_requirement',
    name: 'Normative Bridge Requirement',
    description:
      'Normative conclusions must not follow directly from descriptive facts alone.',
    applies_to: ['normative'],
    severity: 'critical',
    deterministic_check: true
  },
  {
    id: 'source_diversity',
    name: 'Source Diversity',
    description:
      'Verification should not rely on a single source when broader support is needed.',
    applies_to: ['empirical', 'causal', 'predictive'],
    severity: 'info',
    deterministic_check: true
  }
];
