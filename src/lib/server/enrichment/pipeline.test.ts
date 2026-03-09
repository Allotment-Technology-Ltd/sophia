import { describe, expect, it } from 'vitest';
import { runDepthEnrichment } from './pipeline';

describe('runDepthEnrichment', () => {
  it('suppresses when feature flag is disabled', async () => {
    delete process.env.ENABLE_DEPTH_ENRICHMENT;

    const result = await runDepthEnrichment({
      query: 'test',
      queryRunId: 'run:test',
      passClaims: {},
      passRelations: {},
      baseNodes: [],
      baseEdges: [],
      retrieval: {},
      groundingSources: []
    });

    expect(result.status).toBe('suppressed');
    expect(result.reason).toBe('feature_flag_disabled');
  });

  it('suppresses when no enrichment candidates are generated', async () => {
    process.env.ENABLE_DEPTH_ENRICHMENT = 'true';

    const result = await runDepthEnrichment({
      query: 'test',
      queryRunId: 'run:test',
      passClaims: { analysis: [] },
      passRelations: { analysis: [] },
      baseNodes: [],
      baseEdges: [],
      retrieval: { claims_retrieved: 10, retrieval_degraded: false },
      groundingSources: []
    });

    expect(result.status).toBe('suppressed');
    expect(result.reason).toBe('no_candidates');
  });
});
