import { describe, expect, it } from 'vitest';
import { buildModelDiffResult, comparePasses } from './modelDiff';

describe('comparePasses', () => {
  it('computes overlap and unique deltas', () => {
    const result = comparePasses({
      gemini: 'Claim A is true for this argument and remains central. Claim B needs much stronger evidence than provided. Shared conclusion remains uncertain in both accounts.',
      claude: 'Claim A is true for this argument and remains central. Shared conclusion remains uncertain in both accounts. Claim C challenges premise B on empirical grounds.'
    });

    expect(result.overlapRatio).toBeGreaterThan(0);
    expect(result.tokenCountGemini).toBeGreaterThan(0);
    expect(result.tokenCountClaude).toBeGreaterThan(0);
    expect(result.uniqueToGemini.length).toBeGreaterThan(0);
    expect(result.uniqueToClaude.length).toBeGreaterThan(0);
  });
});

describe('buildModelDiffResult', () => {
  it('returns pass diffs for populated passes only', () => {
    const result = buildModelDiffResult({
      analysis: {
        gemini: 'One analysis sentence with detail.',
        claude: 'One analysis sentence with different detail.'
      },
      critique: {
        gemini: '',
        claude: ''
      }
    });

    expect(result.byPass.analysis).toBeDefined();
    expect(result.byPass.critique).toBeUndefined();
  });
});
