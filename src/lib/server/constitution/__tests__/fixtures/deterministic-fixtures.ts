import type { ExtractedClaim, ExtractedRelation } from '$lib/types/verification';

export interface ConstitutionFixture {
  text: string;
  claims: ExtractedClaim[];
  relations: ExtractedRelation[];
}

function claim(overrides: Partial<ExtractedClaim> & Pick<ExtractedClaim, 'id'>): ExtractedClaim {
  return {
    id: overrides.id,
    text: overrides.text ?? `Claim ${overrides.id}`,
    claim_type: overrides.claim_type ?? 'empirical',
    scope: overrides.scope ?? 'moderate',
    confidence: overrides.confidence ?? 0.8,
    source_span: overrides.source_span,
    source_span_start: overrides.source_span_start,
    source_span_end: overrides.source_span_end
  };
}

function relation(
  overrides: Partial<ExtractedRelation> &
    Pick<ExtractedRelation, 'from_claim_id' | 'to_claim_id' | 'relation_type'>
): ExtractedRelation {
  return {
    from_claim_id: overrides.from_claim_id,
    to_claim_id: overrides.to_claim_id,
    relation_type: overrides.relation_type,
    confidence: overrides.confidence ?? 0.85,
    rationale: overrides.rationale ?? 'Fixture relation'
  };
}

export const deterministicFixtures: Record<string, ConstitutionFixture> = {
  evidence_requirement_violation: {
    text: 'Vaccines cause neurological harm in all cases.',
    claims: [
      claim({
        id: 'c_empirical_no_support',
        text: 'Vaccines cause neurological harm in all cases.',
        claim_type: 'empirical',
        scope: 'universal'
      })
    ],
    relations: []
  },

  contradiction_addressed: {
    text: 'Evidence is mixed: one dataset contradicts another, but the second is qualified by sample bias.',
    claims: [
      claim({
        id: 'c_a',
        text: 'Policy X reduces recidivism.',
        claim_type: 'empirical'
      }),
      claim({
        id: 'c_b',
        text: 'Policy X has no effect on recidivism.',
        claim_type: 'empirical'
      })
    ],
    relations: [
      relation({
        from_claim_id: 'c_a',
        to_claim_id: 'c_b',
        relation_type: 'contradicts',
        rationale: 'Conflicting outcomes across studies.'
      }),
      relation({
        from_claim_id: 'c_a',
        to_claim_id: 'c_b',
        relation_type: 'qualifies',
        rationale: 'The negative result used a biased sample.'
      })
    ]
  },

  normative_bridge_violation: {
    text: 'Because the intervention improved outcomes, governments ought to mandate it.',
    claims: [
      claim({
        id: 'c_normative',
        text: 'Governments ought to mandate the intervention.',
        claim_type: 'normative',
        scope: 'broad'
      }),
      claim({
        id: 'c_empirical',
        text: 'The intervention improved measured outcomes.',
        claim_type: 'empirical'
      })
    ],
    relations: [
      relation({
        from_claim_id: 'c_normative',
        to_claim_id: 'c_empirical',
        relation_type: 'depends_on',
        rationale: 'The normative recommendation depends only on observed outcomes.'
      })
    ]
  },

  source_diversity_violation: {
    text: 'All schools should adopt method M because one study reports strong gains.',
    claims: [
      claim({
        id: 'c_broad',
        text: 'All schools should adopt method M.',
        claim_type: 'empirical',
        scope: 'broad'
      }),
      claim({
        id: 'c_support_single_source',
        text: 'A single study reports strong gains for method M.',
        claim_type: 'empirical',
        scope: 'moderate',
        source_span: 'Study Alpha (2025)'
      })
    ],
    relations: [
      relation({
        from_claim_id: 'c_support_single_source',
        to_claim_id: 'c_broad',
        relation_type: 'supports',
        rationale: 'One study is used as the only support.'
      })
    ]
  },

  hybrid_batch: {
    text: 'The intervention likely improves outcomes, but uncertainty remains and alternatives should be considered.',
    claims: [
      claim({
        id: 'c_causal',
        text: 'The intervention causes better outcomes.',
        claim_type: 'causal',
        scope: 'broad'
      }),
      claim({
        id: 'c_empirical_support',
        text: 'Observed outcomes improved after intervention.',
        claim_type: 'empirical',
        scope: 'broad',
        source_span: 'Dataset A'
      }),
      claim({
        id: 'c_explanatory_support',
        text: 'Mechanism M plausibly links intervention to outcomes.',
        claim_type: 'explanatory',
        scope: 'broad',
        source_span: 'Mechanism paper'
      })
    ],
    relations: [
      relation({
        from_claim_id: 'c_empirical_support',
        to_claim_id: 'c_causal',
        relation_type: 'supports'
      }),
      relation({
        from_claim_id: 'c_explanatory_support',
        to_claim_id: 'c_causal',
        relation_type: 'supports'
      })
    ]
  }
};
