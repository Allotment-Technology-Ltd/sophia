import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/engine', () => ({
  runDialecticalEngine: vi.fn(async (_query, callbacks) => {
    callbacks.onPassStart('analysis');
    callbacks.onPassChunk('analysis', 'analysis chunk');
    callbacks.onPassComplete('analysis');
    callbacks.onMetadata(10, 20, 30, {
      claims_retrieved: 1,
      arguments_retrieved: 1,
      detected_domain: 'test',
      domain_confidence: 'high'
    });
  })
}));

vi.mock('$lib/server/verification/pipeline', () => ({
  runVerificationPipeline: vi.fn(async () => ({
    inputText: 'query',
    extracted_claims: [],
    logical_relations: [],
    reasoning_quality: {
      overall_score: 0.5,
      dimensions: []
    },
    constitutional_check: {
      rules_evaluated: 10,
      satisfied: [],
      violated: [],
      uncertain: [],
      not_applicable: [],
      overall_compliance: 'pass'
    },
    pass_outputs: undefined,
    retrieval: undefined,
    extraction_input_tokens: 0,
    extraction_output_tokens: 0,
    constitution_duration_ms: 5,
    constitution_input_tokens: 2,
    constitution_output_tokens: 3,
    constitution_rule_violations: []
  }))
}));

vi.mock('$lib/server/db', () => ({
  query: vi.fn(async () => [])
}));

vi.mock('$lib/server/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn(async () => ({ empty: true }))
              }))
            }))
          }))
        }))
      }))
    }))
  }
}));

import { POST } from '../../../routes/api/analyse/+server';

async function readSseEvents(response: Response): Promise<any[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];

  const decoder = new TextDecoder();
  let buffer = '';
  const events: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data: ')) continue;
      events.push(JSON.parse(line.slice(6)));
    }
  }

  return events;
}

describe('/api/analyse constitution flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_CONSTITUTION_IN_ANALYSE;
  });

  it('does not emit constitution_check when flag is disabled', async () => {
    process.env.ENABLE_CONSTITUTION_IN_ANALYSE = 'false';

    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test query' })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    const events = await readSseEvents(response);

    expect(events.some((event) => event.type === 'constitution_check')).toBe(false);
  });

  it('emits constitution_check when flag is enabled', async () => {
    process.env.ENABLE_CONSTITUTION_IN_ANALYSE = 'true';

    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test query' })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    const events = await readSseEvents(response);

    const constitutionEvent = events.find((event) => event.type === 'constitution_check');
    expect(constitutionEvent).toBeTruthy();
    expect(constitutionEvent.constitutional_check.rules_evaluated).toBe(10);
  });
});
