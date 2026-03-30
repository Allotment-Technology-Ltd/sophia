import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRetrieveContext, mockQuery } = vi.hoisted(() => ({
  mockRetrieveContext: vi.fn(),
  mockQuery: vi.fn()
}));

vi.mock('$lib/server/retrieval', () => ({
  retrieveContext: mockRetrieveContext
}));

vi.mock('$lib/server/db', () => ({
  query: mockQuery
}));

import { retrieveStoaGroundingWithMode } from './grounding';

describe('retrieveStoaGroundingWithMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns graph_dense when primary retrieval succeeds', async () => {
    mockRetrieveContext.mockResolvedValue({
      claims: [
        {
          id: 'claim:1',
          text: 'Focus on what is in your control.',
          source_author: ['Epictetus'],
          source_title: 'Enchiridion',
          confidence: 0.91
        }
      ]
    });

    const result = await retrieveStoaGroundingWithMode({
      message: 'How do I handle stress?',
      history: [],
      topK: 5
    });

    expect(result.mode).toBe('graph_dense');
    expect(result.confidence).toBe('high');
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].claimId).toBe('claim:1');
  });

  it('falls back to lexical mode when graph retrieval throws', async () => {
    mockRetrieveContext.mockRejectedValue(new Error('retrieval error'));
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 'claim:10',
          text: 'Addiction urges can be examined as impressions before assent.',
          source: 'source:abc',
          confidence: 0.88
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'source:abc',
          title: 'Stoic Practice and Habit',
          author: ['Seneca']
        }
      ]);

    const result = await retrieveStoaGroundingWithMode({
      message: 'What should I do about addiction urges?',
      history: [],
      topK: 3
    });

    expect(result.mode).toBe('lexical_fallback');
    expect(result.confidence).toBe('medium');
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims[0].sourceWork).toBe('Stoic Practice and Habit');
  });
});

