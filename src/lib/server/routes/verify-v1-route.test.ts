import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/apiAuth', () => ({
  verifyApiKey: vi.fn(async () => ({ valid: true, key_id: 'k_test' }))
}));

vi.mock('$lib/server/analytics', () => ({
  logServerAnalytics: vi.fn(async () => {})
}));

vi.mock('$lib/server/reasoningEngine', () => ({
  runDomainAgnosticReasoning: vi.fn(async (_input, callbacks) => {
    callbacks.onPassChunk('analysis', 'A');
    callbacks.onPassChunk('critique', 'C');
    callbacks.onPassChunk('synthesis', 'S');
    callbacks.onMetadata(1, 2, 3, {
      claims_retrieved: 1,
      arguments_retrieved: 1,
      detected_domain: 'test',
      domain_confidence: 'high'
    });
  })
}));

vi.mock('$lib/server/extraction', () => ({
  extractClaims: vi.fn(async () => ({
    claims: [
      {
        id: 'c1',
        text: 'Claim',
        claim_type: 'empirical',
        scope: 'moderate',
        confidence: 0.8
      }
    ],
    relations: [],
    metadata: {
      source_length: 10,
      extraction_model: 'test',
      extraction_duration_ms: 2,
      tokens_used: { input: 5, output: 6 }
    }
  }))
}));

vi.mock('$lib/server/reasoningEval', () => ({
  evaluateReasoning: vi.fn(async () => ({
    overall_score: 0.4,
    dimensions: [
      { dimension: 'logical_structure', score: 0.4, explanation: 'ok' },
      { dimension: 'evidence_grounding', score: 0.4, explanation: 'ok' },
      { dimension: 'counterargument_coverage', score: 0.4, explanation: 'ok' },
      { dimension: 'scope_calibration', score: 0.4, explanation: 'ok' },
      { dimension: 'assumption_transparency', score: 0.4, explanation: 'ok' },
      { dimension: 'internal_consistency', score: 0.4, explanation: 'ok' }
    ]
  }))
}));

vi.mock('$lib/server/constitution/evaluator', () => ({
  evaluateConstitutionWithTelemetry: vi.fn(async () => ({
    check: {
      rules_evaluated: 10,
      satisfied: [],
      violated: [],
      uncertain: [],
      not_applicable: [],
      overall_compliance: 'pass'
    },
    telemetry: {
      constitution_input_tokens: 7,
      constitution_output_tokens: 8,
      constitution_llm_called: true,
      constitution_llm_failed: false,
      constitution_rule_violations: []
    }
  }))
}));

import { POST } from '../../../routes/api/v1/verify/+server';
import { runVerificationPipeline } from '$lib/server/verification/pipeline';

describe('/api/v1/verify parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns JSON consistent with shared verification pipeline output for the same input', async () => {
    const requestPayload = {
      text: 'Test input for parity'
    };

    const pipeline = await runVerificationPipeline(requestPayload, { includePassOutputs: true });

    const request = new Request('http://localhost/api/v1/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': 'req_test'
      },
      body: JSON.stringify(requestPayload)
    });

    const response = await POST({ request } as never);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.request_id).toBe('req_test');
    expect(body.extracted_claims).toEqual(pipeline.extracted_claims);
    expect(body.logical_relations).toEqual(pipeline.logical_relations);
    expect(body.reasoning_quality).toEqual(pipeline.reasoning_quality);
    expect(body.constitutional_check).toEqual(pipeline.constitutional_check);
    expect(body.pass_outputs).toEqual(pipeline.pass_outputs);
    expect(body.metadata.constitution_rule_violations).toEqual(
      pipeline.constitution_rule_violations
    );
  });
});
