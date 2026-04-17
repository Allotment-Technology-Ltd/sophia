import { describe, expect, it } from 'vitest';
import { applyJobPipelineFlagsFromWorkerDefaults } from './hydrateIngestPayloadJobDefaults';
import type { IngestRunPayload } from '../ingestRuns';

const basePayload = (): IngestRunPayload => ({
  source_url: 'https://example.com/a',
  source_type: 'institutional',
  validate: false,
  model_chain: {
    extract: 'auto',
    relate: 'auto',
    group: 'auto',
    validate: 'auto',
    remediate: 'auto',
    json_repair: 'auto'
  }
});

describe('applyJobPipelineFlagsFromWorkerDefaults', () => {
  it('sets stop_after_extraction and clears stop_before_store', () => {
    const p = applyJobPipelineFlagsFromWorkerDefaults(basePayload(), {
      stop_after_extraction: true,
      stop_before_store: true
    });
    expect(p.stop_after_extraction).toBe(true);
    expect(p.stop_before_store).toBe(false);
  });

  it('leaves payload unchanged when no flags', () => {
    const b = basePayload();
    const p = applyJobPipelineFlagsFromWorkerDefaults(b, { extractionConcurrency: 2 });
    expect(p).toBe(b);
  });
});
