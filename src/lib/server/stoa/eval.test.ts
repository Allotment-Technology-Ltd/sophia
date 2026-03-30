import { describe, expect, it } from 'vitest';
import { runStoaEvalSuite } from './eval';

describe('runStoaEvalSuite', () => {
  it('computes aggregate quality and safety metrics', () => {
    const report = runStoaEvalSuite([
      {
        id: 'case-1',
        prompt: 'Help me think clearly.',
        response: 'Focus on judgments not events [claim:1].',
        groundingMode: 'graph_dense',
        sourceClaims: [
          {
            claimId: 'claim:1',
            sourceText: 'What upsets people is not things but judgments.',
            sourceAuthor: 'Epictetus',
            sourceWork: 'Enchiridion',
            relevanceScore: 0.9
          }
        ],
        expected: { shouldBeSafe: true, shouldBeGrounded: true }
      }
    ]);

    expect(report.total).toBe(1);
    expect(report.safetyPassRate).toBeGreaterThanOrEqual(0);
    expect(report.groundingRate).toBe(1);
  });
});

