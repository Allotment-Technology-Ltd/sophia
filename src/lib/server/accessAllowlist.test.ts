import { afterEach, describe, expect, it, vi } from 'vitest';
import { passesEarlyAccessAllowlist } from './accessAllowlist';

describe('passesEarlyAccessAllowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows everyone when ALLOWED_EMAILS is empty', () => {
    vi.stubEnv('ALLOWED_EMAILS', '');
    expect(passesEarlyAccessAllowlist({ email: 'any@x.com', user: null })).toBe(true);
  });

  it('allows listed emails without requiring uid', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'a@x.com,b@y.com');
    expect(passesEarlyAccessAllowlist({ email: 'A@x.com', user: null })).toBe(true);
    expect(passesEarlyAccessAllowlist({ email: 'c@z.com', user: null })).toBe(false);
  });

  it('denies unlisted email even when the user is authenticated as non-owner', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'other@x.com');
    expect(
      passesEarlyAccessAllowlist({
        email: 'ops@x.com',
        user: { uid: 'neon-sub-1', role: 'user', roles: ['user'] }
      })
    ).toBe(false);
  });

  it('allows unlisted email when the user is an owner by role', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'other@x.com');
    expect(
      passesEarlyAccessAllowlist({
        email: 'ops@x.com',
        user: { uid: 'neon-sub-1', role: 'owner', roles: ['owner'] }
      })
    ).toBe(true);
  });
});
