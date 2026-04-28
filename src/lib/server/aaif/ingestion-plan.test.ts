import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockResolveExtractionModelRoute,
  mockResolveReasoningModelRoute,
  mockBuildExtractionOpenAiCompatibleRoute,
  mockGetAppAiDefaults,
  mockGetStoredRouteIdForIngestionStage
} = vi.hoisted(() => ({
  mockResolveExtractionModelRoute: vi.fn(),
  mockResolveReasoningModelRoute: vi.fn(),
  mockBuildExtractionOpenAiCompatibleRoute: vi.fn(),
  mockGetAppAiDefaults: vi.fn(),
  mockGetStoredRouteIdForIngestionStage: vi.fn()
}));

vi.mock('$lib/server/embeddings', () => ({
  EMBEDDING_MODEL: 'text-embedding-005',
  getEmbeddingProvider: () => ({ name: 'vertex' })
}));

vi.mock('$lib/server/vertex', () => ({
  resolveExtractionModelRoute: mockResolveExtractionModelRoute,
  resolveReasoningModelRoute: mockResolveReasoningModelRoute,
  buildExtractionOpenAiCompatibleRoute: mockBuildExtractionOpenAiCompatibleRoute
}));

vi.mock('$lib/server/ingestionRouteBindings', () => ({
  getStoredRouteIdForIngestionStage: mockGetStoredRouteIdForIngestionStage
}));

vi.mock('$lib/server/appAiDefaults', () => ({
  getAppAiDefaults: mockGetAppAiDefaults
}));

const emptyAppAiDefaults = {
  defaultRestormelSharedRouteId: null as string | null,
  degradedPrimaryProvider: null as null,
  degradedReasoningModelStandard: null as string | null,
  degradedReasoningModelDeep: null as string | null,
  degradedExtractionModel: null as string | null,
  defaultOpenaiApiKey: null as string | null,
  hasOpenaiCiphertext: false
};

describe('planIngestionStage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue(null);
    mockGetAppAiDefaults.mockResolvedValue({ ...emptyAppAiDefaults });
    mockGetStoredRouteIdForIngestionStage.mockResolvedValue(undefined);
    delete process.env.INGEST_JSON_REPAIR_USE_EXTRACTION_ENDPOINT;
    delete process.env.INGEST_PIN_PROVIDER_JSON_REPAIR;
    delete process.env.INGEST_PIN_MODEL_JSON_REPAIR;
    delete process.env.INGEST_FORCE_EXTRACTION_OPENAI_COMPAT;
  });

  it('uses EXTRACTION_* OpenAI-compatible route when buildExtractionOpenAiCompatibleRoute returns a route', async () => {
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue({
      model: Symbol('ft-model'),
      provider: 'openai',
      modelId: 'accounts/demo/models/extract-ft',
      credentialSource: 'byok',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'OpenAI-compatible ingestion extraction (test).'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('extraction', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 2_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveExtractionModelRoute).not.toHaveBeenCalled();
    expect(plan.provider).toBe('openai');
    expect(plan.model).toBe('accounts/demo/models/extract-ft');
    expect(plan.routingSource).toBe('requested');
    expect(plan.routingReason).toContain('OpenAI-compatible');
  });

  it('forces EXTRACTION_* OpenAI-compatible route even with a bound route when INGEST_FORCE_EXTRACTION_OPENAI_COMPAT=1', async () => {
    process.env.INGEST_FORCE_EXTRACTION_OPENAI_COMPAT = '1';
    mockGetStoredRouteIdForIngestionStage.mockResolvedValue('bound-route-id');
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue({
      model: Symbol('ft-model'),
      provider: 'openai',
      modelId: 'accounts/demo/deployments/extract-ft',
      credentialSource: 'byok',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'OpenAI-compatible ingestion extraction (test).'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('extraction', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 2_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveExtractionModelRoute).not.toHaveBeenCalled();
    expect(plan.provider).toBe('openai');
    expect(plan.model).toBe('accounts/demo/deployments/extract-ft');
  });

  it('uses EXTRACTION_* OpenAI-compatible route for json_repair when enabled (default)', async () => {
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue({
      model: Symbol('repair-model'),
      provider: 'openai',
      modelId: 'accounts/demo/models/extract-ft',
      credentialSource: 'byok',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'OpenAI-compatible ingestion extraction (test).'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('json_repair', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 2_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveReasoningModelRoute).not.toHaveBeenCalled();
    expect(plan.stage).toBe('json_repair');
    expect(plan.provider).toBe('openai');
    expect(plan.model).toBe('accounts/demo/models/extract-ft');
    expect(plan.routingReason).toContain('JSON repair');
  });

  it('uses Restormel json_repair when INGEST_JSON_REPAIR_USE_EXTRACTION_ENDPOINT=0', async () => {
    process.env.INGEST_JSON_REPAIR_USE_EXTRACTION_ENDPOINT = '0';
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue({
      model: Symbol('ft-unused'),
      provider: 'openai',
      modelId: 'accounts/demo/models/extract-ft',
      credentialSource: 'byok',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'would be used for extraction only'
    });
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: Symbol('vertex-repair'),
      provider: 'vertex',
      modelId: 'gemini-3-flash-preview',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'restormel',
      resolvedExplanation: 'json repair via catalog'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('json_repair', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 2_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveReasoningModelRoute).toHaveBeenCalled();
    expect(plan.provider).toBe('vertex');
    expect(plan.model).toBe('gemini-3-flash-preview');
  });

  it('skips EXTRACTION_* mirror for json_repair when INGEST_PIN_*_JSON_REPAIR is set', async () => {
    process.env.INGEST_PIN_PROVIDER_JSON_REPAIR = 'vertex';
    process.env.INGEST_PIN_MODEL_JSON_REPAIR = 'gemini-3-flash-preview';
    mockBuildExtractionOpenAiCompatibleRoute.mockReturnValue({
      model: Symbol('ft-unused'),
      provider: 'openai',
      modelId: 'accounts/demo/models/extract-ft',
      credentialSource: 'byok',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'EXTRACTION mirror would apply without env pin'
    });
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: Symbol('vertex-repair'),
      provider: 'vertex',
      modelId: 'gemini-3-flash-preview',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'restormel',
      resolvedExplanation: 'pinned json repair'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('json_repair', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 2_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveReasoningModelRoute).toHaveBeenCalled();
    expect(plan.provider).toBe('vertex');
    expect(plan.model).toBe('gemini-3-flash-preview');
  });

  it('uses Neon app AI default shared route when per-stage binding is absent', async () => {
    mockGetAppAiDefaults.mockResolvedValue({
      ...emptyAppAiDefaults,
      defaultRestormelSharedRouteId: 'app-default-shared-route'
    });
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: Symbol('rel'),
      provider: 'vertex',
      modelId: 'gemini-3-flash-preview',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'restormel',
      resolvedExplanation: 'relations via app default route'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('relations', {
      sourceTitle: 'Test',
      sourceType: 'sep_entry',
      estimatedTokens: 5_000,
      preferredProvider: 'auto'
    });

    expect(mockResolveReasoningModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: 'app-default-shared-route' })
    );
    expect(plan.provider).toBe('vertex');
    expect(plan.routingSource).toBe('restormel');
  });

  it('builds a Restormel-backed extraction plan', async () => {
    mockResolveExtractionModelRoute.mockResolvedValue({
      model: Symbol('model'),
      provider: 'vertex',
      modelId: 'gemini-3-flash-preview',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'restormel',
      resolvedExplanation: 'route=ingest-extraction step=0 provider=vertex'
    });

    const { planIngestionStage } = await import('./ingestion-plan');
    const plan = await planIngestionStage('extraction', {
      sourceTitle: 'The Human Condition',
      sourceType: 'book',
      estimatedTokens: 9_500,
      preferredProvider: 'auto'
    });

    expect(mockResolveExtractionModelRoute).toHaveBeenCalledWith({
      requestedProvider: 'auto',
      requestedModelId: undefined,
      routeId: undefined,
      failureMode: 'degraded_default',
      restormelContext: {
        workload: 'ingestion',
        stage: 'ingestion_extraction',
        task: 'completion',
        attempt: 1,
        estimatedInputTokens: 9_500,
        estimatedInputChars: 38_000,
        complexity: 'medium',
        constraints: {
          latency: 'low',
          maxCost: undefined
        }
      }
    });
    expect(plan.provider).toBe('vertex');
    expect(plan.model).toBe('gemini-3-flash-preview');
    expect(plan.routingSource).toBe('restormel');
    expect(plan.request.task).toBe('completion');
    expect(plan.request.constraints?.latency).toBe('low');
  });

  it('lets Restormel resolve validation by workload and stage metadata', async () => {
    mockResolveReasoningModelRoute.mockResolvedValue({
      model: Symbol('model'),
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5-20250929',
      credentialSource: 'platform',
      supportsGrounding: false,
      routingSource: 'requested',
      resolvedExplanation: 'operator override'
    });

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
      routeId: undefined,
      requestedProvider: 'anthropic',
      failureMode: 'degraded_default',
      restormelContext: {
        workload: 'ingestion',
        stage: 'ingestion_validation',
        task: 'completion',
        attempt: 1,
        estimatedInputTokens: 34_000,
        estimatedInputChars: 80_000,
        complexity: 'high',
        constraints: {
          latency: 'high',
          maxCost: undefined
        }
      }
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
    expect(plan.routingReason).toContain('vertex embedding pipeline');
  });

  it('builds phase token/complexity estimates for pre-scan', async () => {
    const { buildIngestionStageUsageEstimates } = await import('./ingestion-plan');
    const estimates = buildIngestionStageUsageEstimates({
      sourceTitle: 'Pacifism',
      sourceType: 'sep_entry',
      estimatedTokens: 12_500,
      sourceLengthChars: 50_000
    });

    expect(estimates).toHaveLength(8);
    expect(estimates[0]?.stage).toBe('fetch');
    expect(estimates[0]?.inputTokens).toBeGreaterThan(12_000);
    expect(estimates[1]?.stage).toBe('extraction');
    expect(estimates[1]?.inputTokens).toBeGreaterThan(12_500);
    const grouping = estimates.find((phase) => phase.stage === 'grouping');
    expect(grouping?.complexity).toBe('high');
    expect(grouping?.totalTokens).toBeGreaterThan(0);
    const embedding = estimates.find((phase) => phase.stage === 'embedding');
    expect(embedding?.inputTokens).toBeGreaterThan(0);
    expect(embedding?.totalTokens).toBeGreaterThan(0);
  });

  it('treats long books as higher grouping load before encyclopedia-scale thresholds', async () => {
    const { buildIngestionStageUsageEstimates } = await import('./ingestion-plan');
    const book = buildIngestionStageUsageEstimates({
      sourceTitle: 'Groundwork',
      sourceType: 'book',
      estimatedTokens: 9_000,
      sourceLengthChars: 36_000
    });
    const bookGrouping = book.find((phase) => phase.stage === 'grouping');
    expect(bookGrouping?.latency).toBe('high');

    const sep = buildIngestionStageUsageEstimates({
      sourceTitle: 'Short SEP note',
      sourceType: 'sep_entry',
      estimatedTokens: 5_000,
      sourceLengthChars: 20_000
    });
    const sepGrouping = sep.find((phase) => phase.stage === 'grouping');
    expect(sepGrouping?.latency).toBe('balanced');
  });
});
