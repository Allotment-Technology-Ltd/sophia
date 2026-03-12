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
      position_in_source: 1,
      provenance: {
        bibliographic_identity: {
          title: 'Source A',
          author: ['Author A']
        },
        ingest_version: 'test-v1'
      }
    },
    {
      id: 'b',
      text: 'Claim B',
      claim_type: 'premise',
      domain: 'ethics',
      source_title: 'Source B',
      source_author: ['Author B'],
      confidence: 0.76,
      position_in_source: 2,
      provenance: {
        bibliographic_identity: {
          title: 'Source B',
          author: ['Author B']
        },
        ingest_version: 'test-v1'
      }
    }
  ],
  relations: [
    {
      from_index: 0,
      to_index: 1,
      relation_type: 'supports',
      strength: 'strong',
      note: 'A supports B',
      confidence_weight: 1,
      weighted_score: 0.82,
      provenance: {
        edge_type: 'supports',
        from_claim_id: 'a',
        to_claim_id: 'b',
        edge_prior: 1,
        edge_confidence_weight: 1,
        hop_decay_factor: 1,
        ingest_version: 'test-v1'
      }
    }
  ],
  arguments: [],
  seed_claim_ids: ['a'],
  trace: {
    seed_pool_count: 5,
    selected_seed_count: 1,
    traversed_claim_count: 1,
    relation_candidate_count: 2,
    relation_kept_count: 1,
    argument_candidate_count: 0,
    argument_kept_count: 0,
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
});
