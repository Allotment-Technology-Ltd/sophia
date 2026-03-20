import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveExtractionModelRoute, mockResolveReasoningModelRoute } = vi.hoisted(() => ({
  mockResolveExtractionModelRoute: vi.fn(),
  mockResolveReasoningModelRoute: vi.fn()
}));

vi.mock('$lib/server/embeddings', () => ({
  EMBEDDING_MODEL: 'text-embedding-005'
}));

vi.mock('$lib/server/vertex', () => ({
  resolveExtractionModelRoute: mockResolveExtractionModelRoute,
  resolveReasoningModelRoute: mockResolveReasoningModelRoute
}));

describe('planIngestionStage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.RESTORMEL_INGEST_ROUTE_ID;
    delete process.env.RESTORMEL_INGEST_VALIDATION_ROUTE_ID;
    delete process.env.RESTORMEL_ANALYSE_ROUTE_ID;
    delete process.env.RESTORMEL_VERIFY_ROUTE_ID;
  });

  it('builds a Restormel-backed extraction plan', async () => {
    mockResolveExtractionModelRoute.mockResolvedValue({
      model: Symbol('model'),
      provider: 'vertex',
      modelId: 'gemini-2.5-flash',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'restormel',
      resolvedExplanation: 'route=ingest-extraction step=0 provider=vertex'
    });
    process.env.RESTORMEL_ANALYSE_ROUTE_ID = 'interactive';

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('extraction', {
      sourceTitle: 'The Human Condition',
      sourceType: 'book',
      estimatedTokens: 9_500,
      preferredProvider: 'auto'
    });

    expect(mockResolveExtractionModelRoute).toHaveBeenCalledWith({
      requestedProvider: 'auto',
      routeId: 'interactive',
      failureMode: 'degraded_default'
    });
    expect(plan.provider).toBe('vertex');
    expect(plan.model).toBe('gemini-2.5-flash');
    expect(plan.routingSource).toBe('restormel');
    expect(plan.request.task).toBe('completion');
    expect(plan.request.constraints?.latency).toBe('low');
  });

  it('uses the verification route for validation planning', async () => {
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: Symbol('model'),
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5-20250929',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'operator override'
    });
    process.env.RESTORMEL_VERIFY_ROUTE_ID = 'verification';

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('validation', {
      sourceTitle: 'Ethics',
      estimatedTokens: 20_000,
      claimCount: 120,
      relationCount: 80,
      argumentCount: 18,
      preferredProvider: 'anthropic'
    });

    expect(mockResolveReasoningModelRoute).toHaveBeenCalledWith({
      pass: 'verification',
      depthMode: 'deep',
      routeId: 'verification',
      requestedProvider: 'anthropic',
      failureMode: 'degraded_default'
    });
    expect(plan.provider).toBe('anthropic');
    expect(plan.request.constraints?.latency).toBe('high');
    expect(plan.routingSource).toBe('requested');
  });

  it('keeps embeddings on the fixed Vertex embedding pipeline', async () => {
    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('embedding', {
      sourceTitle: 'Mind and World',
      estimatedTokens: 4_000,
      claimCount: 32,
      claimTextChars: 9_600
    });

    expect(plan.provider).toBe('vertex');
    expect(plan.model).toBe('text-embedding-005');
    expect(plan.route).toBeUndefined();
    expect(plan.request.task).toBe('embedding');
    expect(plan.routingReason).toContain('Vertex embedding pipeline');
  });
});
