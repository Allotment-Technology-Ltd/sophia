import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadByokProviderApiKeys,
  mockGetAvailableReasoningModels,
  mockRestormelEvaluatePolicies
} = vi.hoisted(() => ({
  mockLoadByokProviderApiKeys: vi.fn(),
  mockGetAvailableReasoningModels: vi.fn(),
  mockRestormelEvaluatePolicies: vi.fn()
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: mockLoadByokProviderApiKeys
}));

vi.mock('$lib/server/vertex', () => ({
  getAvailableReasoningModels: mockGetAvailableReasoningModels
}));

vi.mock('$lib/server/restormel', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/restormel')>('$lib/server/restormel');
  return {
    ...actual,
    restormelEvaluatePolicies: mockRestormelEvaluatePolicies
  };
});

describe('/api/allowed-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'vertex,anthropic,openai');
    vi.stubEnv('RESTORMEL_ENVIRONMENT_ID', 'production');
    vi.stubEnv('RESTORMEL_ANALYSE_ROUTE_ID', 'interactive');
    mockLoadByokProviderApiKeys.mockResolvedValue({
      anthropic: 'sk-ant-test',
      openai: 'sk-proj-openai'
    });
    mockGetAvailableReasoningModels.mockReturnValue([
      {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic',
        label: 'Anthropic · claude-3-5-sonnet',
        description: 'User BYOK Anthropic model'
      },
      {
        id: 'gpt-4o',
        provider: 'openai',
        label: 'OpenAI · gpt-4o',
        description: 'User BYOK OpenAI model'
      }
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('filters available models through Restormel policy evaluation', async () => {
    mockRestormelEvaluatePolicies.mockImplementation(async ({ modelId, providerType }) => ({
      data: {
        allowed: modelId === 'claude-3-5-sonnet' && providerType === 'anthropic',
        violations: []
      }
    }));

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:byok' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=byok&byok_provider=anthropic')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering).toEqual({
      active: true,
      degraded: false,
      routeId: 'interactive'
    });
    expect(body.models).toEqual([
      {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic',
        label: 'Anthropic · claude-3-5-sonnet',
        description: 'User BYOK Anthropic model'
      }
    ]);
    expect(body.allowed_by_provider.anthropic).toContain('claude-3-5-sonnet');
    expect(body.allowed_by_provider.openai).not.toContain('gpt-4o');
  });

  it('returns local fallback models with a warning when policy evaluation fails', async () => {
    mockRestormelEvaluatePolicies.mockRejectedValue(new Error('gateway unavailable'));

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:platform' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=platform')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering).toEqual({
      active: false,
      degraded: true,
      routeId: 'interactive'
    });
    expect(body.error).toContain('Policy-filtered models are temporarily unavailable');
    expect(body.models).toEqual([
      {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic',
        label: 'Anthropic · claude-3-5-sonnet',
        description: 'User BYOK Anthropic model'
      },
      {
        id: 'gpt-4o',
        provider: 'openai',
        label: 'OpenAI · gpt-4o',
        description: 'User BYOK OpenAI model'
      }
    ]);
  });
});
