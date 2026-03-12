import { describe, expect, it } from 'vitest';
import { constructSeedSet, type SeedCandidate } from './seedSetConstructor';

function candidate(
  id: string,
  claimType: string,
  text: string,
  embedding: number[],
  sourceTitle: string
): SeedCandidate {
  return {
    id,
    claim_type: claimType,
    text,
    embedding,
    confidence: 0.8,
    source_title: sourceTitle
  };
}

describe('constructSeedSet', () => {
  it('enforces objection/reply/definition quotas when available', () => {
    const candidates: SeedCandidate[] = [
      candidate('s1', 'thesis', 'Utilitarian claim one', [1, 0, 0], 'A'),
      candidate('s2', 'premise', 'Utilitarian claim two', [0.95, 0.05, 0], 'B'),
      candidate('s3', 'premise', 'Utilitarian claim three', [0.9, 0.1, 0], 'C'),
      candidate('o1', 'objection', 'Strong objection to utilitarianism', [0.1, 0.9, 0], 'D'),
      candidate('r1', 'response', 'Reply to that objection', [0.12, 0.85, 0.03], 'E'),
      candidate('d1', 'definition', 'Definition of public reason', [0.05, 0.2, 0.75], 'F')
    ];

    const result = constructSeedSet({
      candidates,
      topK: 6,
      queryEmbedding: [1, 0, 0]
    });

    expect(result.seeds).toHaveLength(6);
    expect(result.stats.role_counts_selected.objection).toBeGreaterThanOrEqual(1);
    expect(result.stats.role_counts_selected.reply).toBeGreaterThanOrEqual(1);
    expect(result.stats.role_counts_selected.definition_distinction).toBeGreaterThanOrEqual(1);
    expect(result.stats.objection_reply_presence_after).toBe(true);
    expect(result.stats.mono_perspective_after).toBe(false);
  });

  it('reduces redundancy versus rank-order baseline', () => {
    const candidates: SeedCandidate[] = [
      candidate('a1', 'premise', 'Very similar claim A1', [1, 0, 0], 'A'),
      candidate('a2', 'premise', 'Very similar claim A2', [0.99, 0.01, 0], 'B'),
      candidate('a3', 'premise', 'Very similar claim A3', [0.98, 0.02, 0], 'C'),
      candidate('b1', 'objection', 'Different objection B1', [0, 1, 0], 'D'),
      candidate('c1', 'definition', 'Different definition C1', [0, 0, 1], 'E'),
      candidate('r1', 'response', 'Different reply R1', [0, 0.8, 0.2], 'F')
    ];

    const result = constructSeedSet({
      candidates,
      topK: 4,
      queryEmbedding: [1, 0, 0]
    });

    expect(result.stats.avg_pairwise_similarity_after).toBeLessThan(
      result.stats.avg_pairwise_similarity_before
    );
  });
});
