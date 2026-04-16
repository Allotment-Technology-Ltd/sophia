import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateAnthropic,
  mockCreateGoogleGenerativeAI,
  mockCreateMistral,
  mockCreateOpenAI,
  mockLoadServerEnv,
  mockResolveProviderDecision
} = vi.hoisted(() => ({
  mockCreateAnthropic: vi.fn(() => vi.fn((modelId: string) => `anthropic:${modelId}`)),
  mockCreateGoogleGenerativeAI: vi.fn(() => vi.fn((modelId: string) => `google:${modelId}`)),
  mockCreateMistral: vi.fn(() => vi.fn((modelId: string) => `mistral:${modelId}`)),
  mockCreateOpenAI: vi.fn(() => {
    const provider = ((modelId: string) => `openai-responses:${modelId}`) as any;
    provider.chat = vi.fn((modelId: string) => `openai-chat:${modelId}`);
    return provider;
  }),
  mockLoadServerEnv: vi.fn(),
  mockResolveProviderDecision: vi.fn()
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mockCreateGoogleGenerativeAI
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI
}));

vi.mock('@ai-sdk/mistral', () => ({
  createMistral: mockCreateMistral
}));

vi.mock('./env', () => ({
  loadServerEnv: mockLoadServerEnv
}));

vi.mock('./resolve-provider', () => ({
  resolveProviderDecision: mockResolveProviderDecision
}));

describe('resolveReasoningModelRoute', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GOOGLE_AI_API_KEY = 'AIza-default-test';
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.EXTRACTION_BASE_URL;
    delete process.env.EXTRACTION_MODEL;
    delete process.env.EXTRACTION_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.FIREWORKS_API_KEY;
  });

  it('uses the degraded default when Restormel selects a provider Sophia cannot execute locally', async () => {
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=anthropic model=claude-3-5-sonnet',
      selectedStepId: 'step-1',
      fallbackCandidates: [{ stepId: 'step-2', providerType: 'openai', modelId: 'gpt-4o' }]
    });

    const { resolveReasoningModelRoute } = await import('./vertex');
    const route = await resolveReasoningModelRoute({
      routeId: 'interactive',
      failureMode: 'degraded_default'
    });

    expect(route.provider).toBe('vertex');
    expect(route.routingSource).toBe('degraded_default');
    expect(route.resolvedFailureKind).toBe('no_key_available');
    expect(route.resolvedRouteId).toBe('interactive');
    expect(route.resolvedFallbackCandidates).toEqual([
      { stepId: 'step-2', providerType: 'openai', modelId: 'gpt-4o' }
    ]);
    expect(route.resolvedExplanation).toContain('degraded default');
  });

  it('throws when strict callers receive an unavailable provider selection', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'mistral',
      model: 'mistral-large-latest',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=mistral'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');

    await expect(
      resolveReasoningModelRoute({
        routeId: 'interactive',
        failureMode: 'error'
      })
    ).rejects.toThrow('mistral provider requested but no BYOK key or platform API key is configured');
  });

  it('uses chat-completions path for non-openai compatible providers', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'openrouter',
      model: 'openrouter/auto',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=openrouter model=openrouter/auto'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');
    const route = await resolveReasoningModelRoute({ routeId: 'interactive' });

    expect(route.provider).toBe('openrouter');
    expect(route.model).toBe('openai-chat:openrouter/auto');
  });

  it('uses @ai-sdk/google for platform vertex when GOOGLE_AI_API_KEY is set', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-test';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=vertex model=gemini-3-flash-preview'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');
    const route = await resolveReasoningModelRoute({ routeId: 'interactive' });

    expect(route.provider).toBe('vertex');
    expect(route.model).toBe('google:gemini-3-flash-preview');
    expect(mockCreateGoogleGenerativeAI).toHaveBeenCalled();
  });

  it('throws when platform vertex is selected but GOOGLE_AI_API_KEY is unset', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=vertex model=gemini-3-flash-preview'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');

    await expect(resolveReasoningModelRoute({ routeId: 'interactive', failureMode: 'error' })).rejects.toThrow(
      /vertex provider requested/
    );
  });


  it('uses @ai-sdk/mistral for Mistral (not OpenAI-compatible client; avoids max_completion_tokens 422)', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'mistral',
      model: 'mistral-large-latest',
      source: 'restormel',
      routeId: 'ingestion_relations',
      explanation: 'route=ingestion_relations step=0 provider=mistral model=mistral-large-latest'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');
    const route = await resolveReasoningModelRoute({ routeId: 'ingestion_relations' });

    expect(route.provider).toBe('mistral');
    expect(route.model).toBe('mistral:mistral-large-latest');
    expect(mockCreateMistral).toHaveBeenCalled();
    expect(mockCreateOpenAI).not.toHaveBeenCalled();
  });

  it('normalizes bare claude-sonnet-4 slug to dated Anthropic API id (extraction / ingest pins)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      source: 'requested',
      explanation: 'preferred provider=anthropic model=claude-sonnet-4'
    });

    const { resolveExtractionModelRoute } = await import('./vertex');
    const route = await resolveExtractionModelRoute({
      requestedProvider: 'anthropic',
      requestedModelId: 'claude-sonnet-4'
    });

    expect(route.provider).toBe('anthropic');
    expect(route.modelId).toBe('claude-sonnet-4-20250514');
    expect(route.model).toBe('anthropic:claude-sonnet-4-20250514');
  });

  it('buildExtractionOpenAiCompatibleRoute returns null without EXTRACTION_BASE_URL', async () => {
    const { buildExtractionOpenAiCompatibleRoute } = await import('./vertex');
    expect(buildExtractionOpenAiCompatibleRoute()).toBeNull();
  });

  it('buildExtractionOpenAiCompatibleRoute uses createOpenAI when EXTRACTION_* configured', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-default-test';
    process.env.EXTRACTION_BASE_URL = 'https://example.invalid/v1';
    process.env.EXTRACTION_MODEL = 'accounts/demo/models/extract-ft';
    process.env.OPENAI_API_KEY = 'sk-test-openai';

    const { buildExtractionOpenAiCompatibleRoute } = await import('./vertex');
    const route = buildExtractionOpenAiCompatibleRoute();
    expect(route).not.toBeNull();
    expect(route?.provider).toBe('openai');
    expect(route?.modelId).toBe('accounts/demo/models/extract-ft');
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.invalid/v1',
        apiKey: 'sk-test-openai'
      })
    );
  });

  it('buildExtractionOpenAiCompatibleRoute falls back to FIREWORKS_API_KEY for Fireworks base URL', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-default-test';
    process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
    process.env.EXTRACTION_MODEL = 'accounts/demo/deployments/extract-1';
    process.env.FIREWORKS_API_KEY = 'fw-test-key';

    const { buildExtractionOpenAiCompatibleRoute } = await import('./vertex');
    const route = buildExtractionOpenAiCompatibleRoute();
    expect(route).not.toBeNull();
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.fireworks.ai/inference/v1',
        apiKey: 'fw-test-key'
      })
    );
  });

  it('buildExtractionOpenAiCompatibleRoute prefers FIREWORKS_API_KEY over operator OPENAI_API_KEY on Fireworks host', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-default-test';
    process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
    process.env.EXTRACTION_MODEL = 'accounts/demo/deployments/extract-1';
    process.env.FIREWORKS_API_KEY = 'fw-test-key';
    process.env.OPENAI_API_KEY = 'sk-openai-from-byok-merge';

    const { buildExtractionOpenAiCompatibleRoute } = await import('./vertex');
    const route = buildExtractionOpenAiCompatibleRoute();
    expect(route).not.toBeNull();
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.fireworks.ai/inference/v1',
        apiKey: 'fw-test-key'
      })
    );
  });

  it('buildExtractionOpenAiCompatibleRoute uses GOOGLE_AI_API_KEY for Google OpenAI-compatible base URL', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-gemini-openai-compat';
    delete process.env.OPENAI_API_KEY;
    process.env.EXTRACTION_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
    process.env.EXTRACTION_MODEL = 'gemini-2.0-flash';

    const { buildExtractionOpenAiCompatibleRoute } = await import('./vertex');
    const route = buildExtractionOpenAiCompatibleRoute();
    expect(route).not.toBeNull();
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-gemini-openai-compat'
      })
    );
  });

  it('falls back to anthropic default when Restormel returns an unknown anthropic model id', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250914',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=anthropic model=claude-sonnet-4-5-20250914'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');
    const route = await resolveReasoningModelRoute({ routeId: 'interactive' });

    expect(route.provider).toBe('anthropic');
    expect(route.model).not.toBe('anthropic:claude-sonnet-4-5-20250914');
    expect(route.model).toContain('anthropic:');
  });
});
