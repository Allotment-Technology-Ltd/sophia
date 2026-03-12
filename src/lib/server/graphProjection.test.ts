import { describe, expect, it } from 'vitest';
import { projectRetrievalToGraph } from './graphProjection';
import type { RetrievalResult } from './retrieval';

const baseRetrieval: RetrievalResult = {
  claims: [
    {
      id: 'a',
      text: 'Claim A',
      claim_type: 'thesis',
      domain: 'ethics',
      source_title: 'Source A',
      source_author: ['Author A'],
      confidence: 0.82,
      position_in_source: 1
    },
    {
      id: 'b',
      text: 'Claim B',
      claim_type: 'premise',
      domain: 'ethics',
      source_title: 'Source B',
      source_author: ['Author B'],
      confidence: 0.76,
      position_in_source: 2
    }
  ],
  relations: [
    {
      from_index: 0,
      to_index: 1,
      relation_type: 'supports',
      strength: 'strong',
      note: 'A supports B'
    }
  ],
  arguments: [],
  seed_claim_ids: ['a'],
  trace: {
    seed_pool_count: 5,
    selected_seed_count: 1,
    traversal_mode: 'beam_trusted_v1',
    traversal_max_hops: 2,
    traversal_hop_decay: 0.78,
    traversal_base_confidence_threshold: 0.38,
    traversal_confidence_thresholds: [0.38, 0.46],
    traversal_domain_aware: true,
    traversal_trusted_edges_only: true,
    traversal_edge_priors: { supports: 1.04, contradicts: 1.16 },
    query_decomposition: {
      focus_mode: 'focused',
      domain_filter: 'ethics',
      hybrid_mode: 'auto',
      corpus_level_query: false,
      lexical_terms: ['public reason'],
      lexical_term_count: 1
    },
    seed_claims: [
      {
        id: 'a',
        claim_type: 'thesis',
        domain: 'ethics',
        source_title: 'Source A',
        confidence: 0.82
      }
    ],
    pruning_summary: {
      claims_by_reason: {
        seed_pool_pruned: 1,
        duplicate_traversal: 0,
        confidence_gate: 0,
        source_integrity_gate: 0
      },
      relations_by_reason: {
        duplicate_relation: 1,
        missing_endpoint: 0
      }
    },
    traversed_claim_count: 1,
    relation_candidate_count: 2,
    relation_kept_count: 1,
    argument_candidate_count: 0,
    argument_kept_count: 0,
    closure_stats: {
      major_thesis_count: 1,
      units_attempted: 1,
      units_completed: 1,
      claims_added_for_closure: 1,
      objections_added: 1,
      replies_added: 0,
      cap_limited_units: 0,
      units: [
        {
          thesis_claim_id: 'a',
          objection_claim_id: 'b',
          objection_found: true,
          reply_found: true,
          unit_complete: true
        }
      ]
    },
    rejected_claims: [
      {
        id: 'c',
        text: 'Claim C',
        source_title: 'Source C',
        confidence: 0.62,
        reason_code: 'seed_pool_pruned',
        considered_in: 'seed_pool'
      }
    ],
    rejected_relations: [
      {
        from_claim_id: 'c',
        to_claim_id: 'b',
        relation_type: 'contradicts',
        reason_code: 'duplicate_relation',
        note: 'Duplicate contradiction'
      }
    ]
  },
  degraded: false
};

describe('projectRetrievalToGraph', () => {
  it('projects rejected traversal candidates into ghost layer metadata', () => {
    const { meta } = projectRetrievalToGraph(baseRetrieval);
    expect(meta.rejectedNodes?.length).toBe(1);
    expect(meta.rejectedEdges?.length).toBe(1);

    const ghostNode = meta.rejectedNodes?.[0];
    expect(ghostNode?.id).toBe('ghost:claim:c');
    expect(ghostNode?.reasonCode).toBe('seed_pool_pruned');
    expect(ghostNode?.pass_origin).toBe('retrieval');

    const ghostEdge = meta.rejectedEdges?.[0];
    expect(ghostEdge?.from).toBe('ghost:claim:c');
    expect(ghostEdge?.to).toBe('claim:b');
    expect(ghostEdge?.type).toBe('contradicts');
    expect(ghostEdge?.reasonCode).toBe('duplicate_relation');
  });

  it('maps conservative relation types into graph edges without legacy aliases', () => {
    const retrieval: RetrievalResult = {
      ...baseRetrieval,
      relations: [
        {
          from_index: 0,
          to_index: 1,
          relation_type: 'defines',
          strength: 'strong',
          note: 'A defines B'
        }
      ]
    };

    const { edges, meta } = projectRetrievalToGraph(retrieval);
    const logicalEdge = edges.find((edge) => edge.from === 'claim:a' && edge.to === 'claim:b');

    expect(logicalEdge?.type).toBe('defines');
    expect(meta.relationTypeCounts?.defines).toBe(1);
  });

  it('maps closure telemetry into snapshot retrieval trace metadata', () => {
    const { meta } = projectRetrievalToGraph(baseRetrieval);
    expect(meta.retrievalTrace?.traversalMode).toBe('beam_trusted_v1');
    expect(meta.retrievalTrace?.traversalTrustedEdgesOnly).toBe(true);
    expect(meta.retrievalTrace?.queryDecomposition?.domainFilter).toBe('ethics');
    expect(meta.retrievalTrace?.seedClaims?.length).toBe(1);
    expect(meta.retrievalTrace?.pruningSummary?.claimsByReason.seed_pool_pruned).toBe(1);
    expect(meta.retrievalTrace?.closureStats?.majorThesisCount).toBe(1);
    expect(meta.retrievalTrace?.closureStats?.unitsCompleted).toBe(1);
    expect(meta.retrievalTrace?.closureStats?.claimsAddedForClosure).toBe(1);
  });
});
