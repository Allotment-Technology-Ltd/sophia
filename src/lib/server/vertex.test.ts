import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateVertex,
  mockCreateAnthropic,
  mockCreateGoogleGenerativeAI,
  mockCreateOpenAI,
  mockLoadServerEnv,
  mockResolveProviderDecision
} = vi.hoisted(() => ({
  mockCreateVertex: vi.fn(() => vi.fn((modelId: string) => `vertex:${modelId}`)),
  mockCreateAnthropic: vi.fn(() => vi.fn((modelId: string) => `anthropic:${modelId}`)),
  mockCreateGoogleGenerativeAI: vi.fn(() => vi.fn((modelId: string) => `google:${modelId}`)),
  mockCreateOpenAI: vi.fn(() => {
    const provider = ((modelId: string) => `openai-responses:${modelId}`) as any;
    provider.chat = vi.fn((modelId: string) => `openai-chat:${modelId}`);
    return provider;
  }),
  mockLoadServerEnv: vi.fn(),
  mockResolveProviderDecision: vi.fn()
}));

vi.mock('@ai-sdk/google-vertex', () => ({
  createVertex: mockCreateVertex
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
    process.env.GOOGLE_VERTEX_PROJECT = 'test-project';
    delete process.env.ANTHROPIC_API_KEY;
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
    mockResolveProviderDecision.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      source: 'restormel',
      routeId: 'interactive',
      explanation: 'route=interactive step=0 provider=anthropic model=claude-3-5-sonnet'
    });

    const { resolveReasoningModelRoute } = await import('./vertex');

    await expect(
      resolveReasoningModelRoute({
        routeId: 'interactive',
        failureMode: 'error'
      })
    ).rejects.toThrow('anthropic provider requested but no BYOK key or platform API key is configured');
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
