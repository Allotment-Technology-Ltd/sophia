import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadByokProviderApiKeys, mockGetAvailableReasoningModels } = vi.hoisted(() => ({
  mockLoadByokProviderApiKeys: vi.fn(),
  mockGetAvailableReasoningModels: vi.fn()
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: mockLoadByokProviderApiKeys
}));

vi.mock('$lib/server/vertex', () => ({
  getAvailableReasoningModels: mockGetAvailableReasoningModels
}));

describe('/api/models', () => {
  beforeEach(() => {
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'vertex,anthropic,openai,voyage');
    vi.clearAllMocks();
    mockLoadByokProviderApiKeys.mockResolvedValue({
      vertex: 'AIza-vertex',
      anthropic: 'sk-ant-test',
      openai: 'sk-proj-openai'
    });
    mockGetAvailableReasoningModels.mockReturnValue([
      {
        id: 'gpt-4.1',
        provider: 'openai',
        label: 'OpenAI · gpt-4.1',
        description: 'User BYOK OpenAI model'
      }
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts byok_provider=openai and scopes model options to OpenAI', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:openai' } },
      url: new URL('http://localhost/api/models?credential_mode=byok&byok_provider=openai')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models).toEqual([
      {
        id: 'gpt-4.1',
        provider: 'openai',
        label: 'OpenAI · gpt-4.1',
        description: 'User BYOK OpenAI model'
      }
    ]);

    expect(mockGetAvailableReasoningModels).toHaveBeenCalledWith({
      providerApiKeys: { openai: 'sk-proj-openai' },
      includePlatformProviders: false,
      allowedProviders: ['openai']
    });
  });

  it('strips BYOK keys when platform mode is requested', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:platform' } },
      url: new URL('http://localhost/api/models?credential_mode=platform')
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetAvailableReasoningModels).toHaveBeenCalledWith({
      providerApiKeys: {},
      includePlatformProviders: true,
      allowedProviders: undefined
    });
  });

  it('returns no reasoning models when byok_provider is non-reasoning (voyage)', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:voyage' } },
      url: new URL('http://localhost/api/models?credential_mode=byok&byok_provider=voyage')
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetAvailableReasoningModels).toHaveBeenCalledWith({
      providerApiKeys: {},
      includePlatformProviders: false,
      allowedProviders: []
    });
  });

  it('rejects BYOK providers that are disabled by rollout gates', async () => {
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'vertex,anthropic');

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:openai-disabled' } },
      url: new URL('http://localhost/api/models?credential_mode=byok&byok_provider=openai')
    } as any);

    expect(response.status).toBe(400);
    expect(mockGetAvailableReasoningModels).not.toHaveBeenCalled();
  });
});
