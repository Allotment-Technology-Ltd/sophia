import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAuth } from '$lib/server/firebase-admin';
import { isNeonAuthEnabled, verifyNeonAuthJwt } from '$lib/server/neon/neonAuthJwt';
import { verifyBearerTokenForApi } from './bearerAuthVerification';

vi.mock('$lib/server/firebase-admin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn()
  }
}));

vi.mock('$lib/server/neon/neonAuthJwt', () => ({
  isNeonAuthEnabled: vi.fn(),
  verifyNeonAuthJwt: vi.fn()
}));

const verifyIdToken = vi.mocked(adminAuth.verifyIdToken);
const mockNeonEnabled = vi.mocked(isNeonAuthEnabled);
const mockVerifyNeon = vi.mocked(verifyNeonAuthJwt);

describe('verifyBearerTokenForApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns firebase profile when Neon auth is disabled', async () => {
    mockNeonEnabled.mockReturnValue(false);
    verifyIdToken.mockResolvedValue({
      uid: 'fb1',
      email: 'a@b.com',
      name: 'Ada',
      picture: 'https://x/p.png'
    } as unknown as Awaited<ReturnType<typeof adminAuth.verifyIdToken>>);

    const out = await verifyBearerTokenForApi('tok');
    expect(out).toEqual({
      uid: 'fb1',
      email: 'a@b.com',
      displayName: 'Ada',
      photoURL: 'https://x/p.png',
      authProvider: 'firebase'
    });
    expect(mockVerifyNeon).not.toHaveBeenCalled();
  });

  it('prefers Neon JWT when Neon auth is enabled and token verifies', async () => {
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
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('falls back to Firebase when Neon verification throws', async () => {
    mockNeonEnabled.mockReturnValue(true);
    mockVerifyNeon.mockRejectedValue(new Error('not neon jwt'));
    verifyIdToken.mockResolvedValue({
      uid: 'fb1',
      email: 'a@b.com',
      name: 'Ada',
      picture: null
    } as unknown as Awaited<ReturnType<typeof adminAuth.verifyIdToken>>);

    const out = await verifyBearerTokenForApi('firebase-token');
    expect(out.authProvider).toBe('firebase');
    expect(out.uid).toBe('fb1');
    expect(verifyIdToken).toHaveBeenCalledTimes(1);
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
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rethrows Firebase error when Neon auth is disabled', async () => {
    mockNeonEnabled.mockReturnValue(false);
    verifyIdToken.mockRejectedValue(new Error('bad token'));

    await expect(verifyBearerTokenForApi('x')).rejects.toThrow('bad token');
    expect(mockVerifyNeon).not.toHaveBeenCalled();
  });

  it('rethrows when Neon throws and Firebase also fails', async () => {
    mockNeonEnabled.mockReturnValue(true);
    mockVerifyNeon.mockRejectedValue(new Error('neon miss'));
    verifyIdToken.mockRejectedValue(new Error('firebase miss'));

    await expect(verifyBearerTokenForApi('x')).rejects.toThrow('firebase miss');
  });
});
