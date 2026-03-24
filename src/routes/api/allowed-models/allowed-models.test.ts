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
    const mockCatalog = [
      {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic' as const,
        label: 'Anthropic · claude-3-5-sonnet',
        description: 'User BYOK Anthropic model'
      },
      {
        id: 'gpt-4o',
        provider: 'openai' as const,
        label: 'OpenAI · gpt-4o',
        description: 'User BYOK OpenAI model'
      }
    ];
    mockGetAvailableReasoningModels.mockImplementation((opts) => {
      const ap = opts?.allowedProviders;
      if (ap?.length) {
        const allow = new Set(ap);
        return mockCatalog.filter((m) => allow.has(m.provider));
      }
      return mockCatalog;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns catalog candidates for BYOK provider without policy evaluation', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:byok' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=byok&byok_provider=anthropic')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering).toEqual({
      active: false,
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
    expect(body.allowed_by_provider.openai).toEqual([]);
  });

  it('returns catalog candidates for platform mode', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:platform' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=platform')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering).toEqual({
      active: false,
      degraded: false,
      routeId: 'interactive'
    });
    expect(body.models).toHaveLength(2);
    expect(body.error).toBeUndefined();
  });

  it('returns all catalog candidates for auto credential mode', async () => {
    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:auto' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering.degraded).toBe(false);
    expect(body.filtering.active).toBe(false);
    expect(body.models).toHaveLength(2);
    expect(body.error).toBeUndefined();
  });
});
