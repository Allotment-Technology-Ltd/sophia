import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadByokProviderApiKeys,
  mockGetAvailableReasoningModels,
  mockRestormelGetLiveReasoningAllowlist
} = vi.hoisted(() => ({
  mockLoadByokProviderApiKeys: vi.fn(),
  mockGetAvailableReasoningModels: vi.fn(),
  mockRestormelGetLiveReasoningAllowlist: vi.fn()
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: mockLoadByokProviderApiKeys
}));

vi.mock('$lib/server/vertex', () => ({
  getAvailableReasoningModels: mockGetAvailableReasoningModels
}));

vi.mock('$lib/server/restormel', () => ({
  RESTORMEL_CATALOG_V5_CONTRACT_VERSION: '2026-03-25.catalog.v5',
  restormelGetLiveReasoningAllowlist: mockRestormelGetLiveReasoningAllowlist
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
    mockRestormelGetLiveReasoningAllowlist.mockResolvedValue({
      allowlist: {
        anthropic: new Set(['claude-3-5-sonnet']),
        openai: new Set(['gpt-4o'])
      },
      contractVersion: '2026-03-25.catalog.v5',
      allFresh: true,
      source: 'live'
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

  it('returns degraded response when external freshness is stale', async () => {
    mockRestormelGetLiveReasoningAllowlist.mockResolvedValueOnce({
      allowlist: {
        anthropic: new Set(['claude-3-5-sonnet']),
        openai: new Set(['gpt-4o'])
      },
      contractVersion: '2026-03-25.catalog.v5',
      allFresh: false,
      source: 'live'
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:stale' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filtering.degraded).toBe(true);
    expect(body.models).toEqual([]);
    expect(body.error).toContain('freshness');
  });
});
