import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNeonAuthEnabled, verifyNeonAuthJwt } from '$lib/server/neon/neonAuthJwt';
import { verifyBearerTokenForApi } from './bearerAuthVerification';

vi.mock('$lib/server/neon/neonAuthJwt', () => ({
  isNeonAuthEnabled: vi.fn(),
  verifyNeonAuthJwt: vi.fn()
}));

const mockNeonEnabled = vi.mocked(isNeonAuthEnabled);
const mockVerifyNeon = vi.mocked(verifyNeonAuthJwt);

describe('verifyBearerTokenForApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when Neon auth is disabled', async () => {
    mockNeonEnabled.mockReturnValue(false);
    await expect(verifyBearerTokenForApi('tok')).rejects.toThrow(/USE_NEON_AUTH/);
    expect(mockVerifyNeon).not.toHaveBeenCalled();
  });

  it('returns neon profile when JWT verifies', async () => {
    mockNeonEnabled.mockReturnValue(true);
    mockVerifyNeon.mockResolvedValue({
      sub: 'neon-sub',
      email: 'n@b.com',
      raw: { name: 'Neo', picture: 'https://y/p.png' }
    });

    const out = await verifyBearerTokenForApi('jwt');
    expect(out).toEqual({
      uid: 'neon-sub',
      email: 'n@b.com',
      displayName: 'Neo',
      photoURL: 'https://y/p.png',
      authProvider: 'neon'
    });
  });

  it('wraps verification errors', async () => {
    mockNeonEnabled.mockReturnValue(true);
    mockVerifyNeon.mockRejectedValue(new Error('jwt invalid'));

    await expect(verifyBearerTokenForApi('x')).rejects.toThrow(/Invalid or expired session/);
  });

  it('uses preferred_username when name is absent on Neon JWT', async () => {
    mockNeonEnabled.mockReturnValue(true);
    mockVerifyNeon.mockResolvedValue({
      sub: 'n2',
      email: undefined,
      raw: { preferred_username: 'neo_user' }
    });

    const out = await verifyBearerTokenForApi('jwt');
    expect(out.displayName).toBe('neo_user');
    expect(out.photoURL).toBeNull();
  });
});
