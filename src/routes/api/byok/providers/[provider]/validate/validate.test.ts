import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetByokProviderApiKey,
  mockListByokProviderStatuses,
  mockSetByokProviderValidationStatus,
  mockValidateProviderApiKey
} = vi.hoisted(() => ({
  mockGetByokProviderApiKey: vi.fn(),
  mockListByokProviderStatuses: vi.fn(),
  mockSetByokProviderValidationStatus: vi.fn(),
  mockValidateProviderApiKey: vi.fn()
}));

vi.mock('$lib/server/byok/store', () => ({
  getByokProviderApiKey: mockGetByokProviderApiKey,
  listByokProviderStatuses: mockListByokProviderStatuses,
  setByokProviderValidationStatus: mockSetByokProviderValidationStatus
}));

vi.mock('$lib/server/byok/validation', () => ({
  validateProviderApiKey: mockValidateProviderApiKey
}));

describe('/api/byok/providers/[provider]/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'openai,voyage,anthropic');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows re-validation of invalid credentials', async () => {
    mockGetByokProviderApiKey.mockResolvedValue('pa-test-voyage');
    mockValidateProviderApiKey.mockResolvedValue({ ok: true });
    mockListByokProviderStatuses.mockResolvedValue([
      {
        provider: 'voyage',
        configured: true,
        status: 'active',
        fingerprint_last8: 'abcdef12',
        validated_at: null,
        updated_at: null,
        last_error: null
      }
    ]);

    const { POST } = await import('./+server');
    const response = await POST({
      locals: { user: { uid: 'user-1' } },
      params: { provider: 'voyage' },
      request: new Request('http://localhost/api/byok/providers/voyage/validate', {
        method: 'POST'
      })
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetByokProviderApiKey).toHaveBeenCalledWith('user-1', 'voyage', {
      allowPending: true,
      allowInvalid: true
    });
    expect(mockValidateProviderApiKey).toHaveBeenCalledWith('voyage', 'pa-test-voyage');
    expect(mockSetByokProviderValidationStatus).toHaveBeenCalledWith('user-1', 'voyage', {
      success: true,
      errorMessage: null
    });
  });
});
