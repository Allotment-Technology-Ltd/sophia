import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadByokProviderApiKeys,
  mockGetAvailableReasoningModels,
  mockRestormelGetLiveReasoningAllowlist,
  mockLoadModelSurfacesConfig
} = vi.hoisted(() => ({
  mockLoadByokProviderApiKeys: vi.fn(),
  mockGetAvailableReasoningModels: vi.fn(),
  mockRestormelGetLiveReasoningAllowlist: vi.fn(),
  mockLoadModelSurfacesConfig: vi.fn()
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: mockLoadByokProviderApiKeys
}));

vi.mock('$lib/server/vertex', () => ({
  getAvailableReasoningModels: mockGetAvailableReasoningModels
}));

vi.mock('$lib/server/restormel', () => ({
  RESTORMEL_CATALOG_V5_CONTRACT_VERSION: '2026-03-25.catalog.v5',
  RESTORMEL_CATALOG_V6_CONTRACT_VERSION: '2026-03-26.catalog.v6',
  RESTORMEL_CATALOG_SUPPORTED_CONTRACT_VERSIONS: ['2026-03-25.catalog.v5', '2026-03-26.catalog.v6'],
  isRestormelCatalogContractSupported: (v: string) =>
    v === '2026-03-25.catalog.v5' || v === '2026-03-26.catalog.v6',
  restormelGetLiveReasoningAllowlist: mockRestormelGetLiveReasoningAllowlist
}));

vi.mock('$lib/server/modelSurfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/modelSurfaces')>();
  return {
    ...actual,
    loadModelSurfacesConfig: () => mockLoadModelSurfacesConfig()
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
    mockLoadModelSurfacesConfig.mockResolvedValue({
      operationsMode: 'default',
      userQueriesMode: 'default',
      lastRestormelSyncError: null
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

  it('excludes embedding-class models from user query options', async () => {
    const mockCatalog = [
      {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic' as const,
        label: 'Anthropic · claude-3-5-sonnet',
        description: 'User BYOK Anthropic model'
      },
      {
        id: 'text-embedding-3-small',
        provider: 'openai' as const,
        label: 'OpenAI · text-embedding-3-small',
        description: 'Embedding'
      }
    ];
    mockGetAvailableReasoningModels.mockReturnValue(mockCatalog);
    mockRestormelGetLiveReasoningAllowlist.mockResolvedValueOnce({
      allowlist: {
        anthropic: new Set(['claude-3-5-sonnet']),
        openai: new Set(['text-embedding-3-small'])
      },
      contractVersion: '2026-03-25.catalog.v5',
      allFresh: true,
      source: 'live'
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:embed' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].id).toBe('claude-3-5-sonnet');
  });

  it('applies explicit user-queries allowlist from model surfaces (legacy)', async () => {
    mockLoadModelSurfacesConfig.mockResolvedValueOnce({
      operationsMode: 'default',
      userQueriesMode: 'explicit',
      userQueriesExplicit: [{ providerType: 'openai', modelId: 'gpt-4o' }],
      lastRestormelSyncError: null
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:explicit' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].id).toBe('gpt-4o');
    expect(body.allowed_by_provider.anthropic).toEqual([]);
  });

  it('applies surfaceAssignments for app inquiry allowlist', async () => {
    mockLoadModelSurfacesConfig.mockResolvedValueOnce({
      operationsMode: 'default',
      userQueriesMode: 'default',
      surfaceAssignments: {
        'openai::gpt-4o': 'ingestion_and_inquiries',
        'anthropic::claude-3-5-sonnet': 'ingestion_only'
      },
      lastRestormelSyncError: null
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:surfaces' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].id).toBe('gpt-4o');
    expect(body.allowed_by_provider.anthropic).toEqual([]);
  });

  it('allows app inquiries when role is app_inquiries_only (not in Restormel index)', async () => {
    mockLoadModelSurfacesConfig.mockResolvedValueOnce({
      operationsMode: 'default',
      userQueriesMode: 'default',
      surfaceAssignments: {
        'openai::gpt-4o': 'app_inquiries_only',
        'anthropic::claude-3-5-sonnet': 'off'
      },
      lastRestormelSyncError: null
    });

    const { GET } = await import('./+server');
    const response = await GET({
      locals: { user: { uid: 'user:inquiries-only' } },
      url: new URL('http://localhost/api/allowed-models?credential_mode=auto')
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].id).toBe('gpt-4o');
  });

  it('returns models with degraded flag when external freshness is stale (last-known allowlist)', async () => {
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
    expect(body.models).toHaveLength(2);
    expect(body.error).toContain('freshness');
  });
});
