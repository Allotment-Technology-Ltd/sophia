import { describe, expect, it } from 'vitest';
import { hasCompleteProvenance, shouldPromoteEdge } from './gates';
import type { EnrichmentCandidateEdge } from '$lib/types/enrichment';

function makeEdge(overrides: Partial<EnrichmentCandidateEdge> = {}): EnrichmentCandidateEdge {
  return {
    from: 'claim:a',
    to: 'claim:b',
    type: 'supports',
    relation_confidence: 0.8,
    evidence_strength: 0.8,
    novelty_score: 0.7,
    relation_rationale: 'Edge rationale with enough detail for review gate.',
    provenance_id: 'prov:1',
    provenance: {
      id: 'prov:1',
      query_run_id: 'run:1',
      pass_id: 'analysis',
      timestamp: new Date().toISOString(),
      source_refs: [{ kind: 'graph_claim', value: 'claim:a' }],
      rationale_text: 'derived from pass analysis',
      confidence_inputs: {
        extraction_confidence: 0.7,
        source_credibility: 0.8,
        corroboration_count: 1,
        contradiction_pressure: 0.1,
        pass_agreement: 0.6
      }
    },
    ...overrides
  };
}

describe('enrichment promotion gates', () => {
  it('validates provenance completeness', () => {
    expect(hasCompleteProvenance(makeEdge())).toBe(true);
    expect(hasCompleteProvenance(makeEdge({ provenance: undefined as any }))).toBe(false);
  });

  it('rejects weak edges and accepts strong edges', () => {
    const strong = shouldPromoteEdge(makeEdge());
    expect(strong.promote).toBe(true);

    const weakEvidence = shouldPromoteEdge(makeEdge({ evidence_strength: 0.1 }));
    expect(weakEvidence.promote).toBe(false);
    expect(weakEvidence.reason).toBe('insufficient_evidence');

    const weakRationale = shouldPromoteEdge(
      makeEdge({ type: 'contradicts', relation_rationale: 'too short' })
    );
    expect(weakRationale.promote).toBe(false);
    expect(weakRationale.reason).toBe('relation_gate_failed');
  });
});
