import { describe, expect, it } from 'vitest';
import { runRestormelPackageMatrixSmoke } from './sophiaRestormelPackageMatrix';

describe('sophiaRestormelPackageMatrix (dogfood imports)', () => {
  it('exercises every @restormel/* dependency wire-up', () => {
    const r = runRestormelPackageMatrixSmoke();
    expect(r.contextPacksBlocks).toBe(3);
    expect(r.graphRagNodeCount).toBe(0);
    expect(r.aaifParsed).toBe(true);
    expect(r.keysProviders).toBeGreaterThan(0);
    expect(r.graphEvalOk).toBe(true);
    expect(r.observabilityRoundTrip).toBe(true);
    expect(r.stateProjected).toBe(true);
    expect(r.providerGate).toBe(true);
    expect(r.reasoningSchema).toBe(true);
  });
});
