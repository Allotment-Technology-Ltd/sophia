import { afterEach, describe, expect, it, vi } from 'vitest';
import { passesEarlyAccessAllowlist } from './accessAllowlist';

describe('passesEarlyAccessAllowlist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows everyone when ALLOWED_EMAILS is empty', () => {
    vi.stubEnv('ALLOWED_EMAILS', '');
    vi.stubEnv('OWNER_EMAILS', '');
    expect(passesEarlyAccessAllowlist({ email: 'any@x.com', user: null })).toBe(true);
  });

  it('allows listed emails without requiring uid', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'a@x.com,b@y.com');
    expect(passesEarlyAccessAllowlist({ email: 'A@x.com', user: null })).toBe(true);
    expect(passesEarlyAccessAllowlist({ email: 'c@z.com', user: null })).toBe(false);
  });

  it('allows OWNER_EMAILS when user is authenticated', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'other@x.com');
    vi.stubEnv('OWNER_EMAILS', 'ops@x.com');
    expect(
      passesEarlyAccessAllowlist({
        email: 'ops@x.com',
        user: { uid: 'neon-sub-1', role: 'user', roles: ['user'] }
      })
    ).toBe(true);
  });

  it('denies OWNER_EMAILS match without a session user', () => {
    vi.stubEnv('ALLOWED_EMAILS', 'other@x.com');
    vi.stubEnv('OWNER_EMAILS', 'ops@x.com');
    expect(passesEarlyAccessAllowlist({ email: 'ops@x.com', user: null })).toBe(false);
  });
});
