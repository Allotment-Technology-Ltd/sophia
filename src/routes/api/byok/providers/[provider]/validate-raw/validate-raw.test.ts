import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockValidateProviderApiKey } = vi.hoisted(() => ({
  mockValidateProviderApiKey: vi.fn()
}));

vi.mock('$lib/server/byok/validation', () => ({
  validateProviderApiKey: mockValidateProviderApiKey
}));

describe('/api/byok/providers/[provider]/validate-raw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'vertex,anthropic,openai');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires authentication', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: {},
      params: { provider: 'openai' },
      request: new Request('http://localhost/api/byok/providers/openai/validate-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 'sk-test' })
      })
    } as any);

    expect(response.status).toBe(401);
    expect(mockValidateProviderApiKey).not.toHaveBeenCalled();
  });

  it('validates the submitted provider key without persisting it', async () => {
    mockValidateProviderApiKey.mockResolvedValue({
      ok: true
    });

    const { POST } = await import('./+server');
    const response = await POST({
      locals: { user: { uid: 'user-1' } },
      params: { provider: 'openai' },
      request: new Request('http://localhost/api/byok/providers/openai/validate-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 'sk-proj-test' })
      })
    } as any);

    expect(response.status).toBe(200);
    expect(mockValidateProviderApiKey).toHaveBeenCalledWith('openai', 'sk-proj-test');
    const body = await response.json();
    expect(body).toEqual({
      provider: 'openai',
      validation: {
        ok: true
      }
    });
  });
});
