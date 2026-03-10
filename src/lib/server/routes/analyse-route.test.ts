import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/engine', () => ({
  runDialecticalEngine: vi.fn(async (_query, callbacks) => {
    callbacks.onPassStart('analysis');
    callbacks.onGroundingSources('analysis', [
      {
        url: 'https://plato.stanford.edu/entries/free-will/',
        title: 'Free Will'
      }
    ]);
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

vi.mock('$lib/server/enrichment/pipeline', () => ({
  runDepthEnrichment: vi.fn(async () => ({
    status: 'staged',
    reason: undefined,
    stagedCount: 2,
    promotedCount: 0,
    queryRunId: 'run:test',
    snapshotId: 'snapshot:test',
    parentSnapshotId: 'snapshot:parent',
    snapshotNodes: [],
    snapshotEdges: []
  }))
}));

vi.mock('$lib/server/enrichment/sourceExtractor', () => ({
  extractFromSource: vi.fn(async (input: { url?: string; mimeType: string }) => ({
    text: `Extracted content for ${input.url ?? 'unknown source'}`,
    spans: [{ start: 0, end: 20 }],
    metadata: {
      mimeType: input.mimeType,
      bytes: 512,
      truncated: false,
      source: input.url ?? 'unknown source'
    }
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
          add: vi.fn(async () => ({})),
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
import { query as dbQuery } from '$lib/server/db';

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
    vi.mocked(dbQuery).mockImplementation(async () => []);
    delete process.env.ENABLE_CONSTITUTION_IN_ANALYSE;
    delete process.env.ENABLE_DEPTH_ENRICHMENT;
    delete process.env.ENABLE_NIGHTLY_LINK_INGESTION;
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

  it('rejects invalid manual domain payloads', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        domain_mode: 'manual'
      })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    expect(response.status).toBe(400);
  });

  it('emits enrichment_status when depth enrichment is enabled', async () => {
    process.env.ENABLE_DEPTH_ENRICHMENT = 'true';

    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test query' })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    const events = await readSseEvents(response);
    const enrichmentEvent = events.find((event) => event.type === 'enrichment_status');

    expect(enrichmentEvent).toBeTruthy();
    expect(enrichmentEvent.status).toBe('staged');
  });

  it('rejects invalid resource_mode values', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        resource_mode: 'turbo'
      })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('resource_mode');
  });

  it('rejects non-boolean queue_for_nightly_ingest', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        queue_for_nightly_ingest: 'yes'
      })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('queue_for_nightly_ingest');
  });

  it('rejects private/local user links', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        user_links: ['http://localhost/secret']
      })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('Blocked private/local URL');
  });

  it('emits phase-1 resource metadata when user links are supplied', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        resource_mode: 'standard',
        user_links: ['https://example.com/a'],
        queue_for_nightly_ingest: true
      })
    });

    const response = await POST({ request, locals: { user: null } } as never);
    const events = await readSseEvents(response);
    const metadataEvent = events.find((event) => event.type === 'metadata');

    expect(metadataEvent).toBeTruthy();
    expect(metadataEvent.resource_mode).toBe('expanded');
    expect(metadataEvent.user_links_count).toBe(1);
    expect(metadataEvent.runtime_links_processed).toBe(1);
    expect(metadataEvent.nightly_queue_enqueued).toBe(2);
  });

  it('queues user + grounding links when queue opt-in is enabled', async () => {
    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        user_links: ['https://example.com/a'],
        queue_for_nightly_ingest: true
      })
    });

    const response = await POST({ request, locals: { user: { uid: 'user:123' } } as any } as never);
    expect(response.status).toBe(200);
    await readSseEvents(response);

    const sqlCalls = vi.mocked(dbQuery).mock.calls.map(([sql]) => String(sql));
    const queueCalls = sqlCalls.filter((sql) => sql.includes('link_ingestion_queue'));
    expect(queueCalls.length).toBeGreaterThan(0);

    const createCalls = queueCalls.filter((sql) => sql.includes('CREATE link_ingestion_queue CONTENT'));
    expect(createCalls.length).toBeGreaterThan(0);
  });

  it('does not queue links when nightly ingestion feature is disabled', async () => {
    process.env.ENABLE_NIGHTLY_LINK_INGESTION = 'false';

    const request = new Request('http://localhost/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        user_links: ['https://example.com/a'],
        queue_for_nightly_ingest: true
      })
    });

    const response = await POST({ request, locals: { user: { uid: 'user:123' } } as any } as never);
    expect(response.status).toBe(200);
    await readSseEvents(response);

    const sqlCalls = vi.mocked(dbQuery).mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes('link_ingestion_queue'))).toBe(false);
  });
});
