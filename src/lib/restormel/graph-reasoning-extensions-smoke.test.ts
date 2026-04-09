import { describe, expect, it } from 'vitest';
import { evaluateReasoningGraph } from '@restormel/graph-reasoning-extensions/evaluation';

/** Smoke test: published `@restormel/graph-reasoning-extensions` resolves and runs. */
describe('@restormel/graph-reasoning-extensions (npm)', () => {
  it('evaluateReasoningGraph accepts empty graph slice', () => {
    const result = evaluateReasoningGraph({
      graph: { nodes: [], edges: [], missingData: [] },
      outputs: []
    });
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
