import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNeonAuthVerificationConfig } from './neonAuthJwt';

describe('resolveNeonAuthVerificationConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives JWKS and trust lists from NEON_AUTH_URL when BASE_URL is unset', () => {
    vi.stubEnv('NEON_AUTH_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe(
      'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json'
    );
    expect(c.trustedIssuers).toEqual(
      expect.arrayContaining([
        'https://ep-x.neonauth.us-east-1.aws.neon.tech',
        'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth'
      ])
    );
    expect(c.trustedAudiences).toEqual(
      expect.arrayContaining([
        'https://ep-x.neonauth.us-east-1.aws.neon.tech',
        'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth'
      ])
    );
  });

  it('derives from NEON_AUTH_BASE_URL', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe(
      'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json'
    );
    expect(c.trustedIssuers).toContain('https://ep-x.neonauth.us-east-1.aws.neon.tech');
    expect(c.trustedAudiences).toContain('https://ep-x.neonauth.us-east-1.aws.neon.tech');
  });

  it('allows explicit JWKS URL override when BASE_URL is set', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://custom.example/jwks.json');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe('https://custom.example/jwks.json');
  });

  it('merges NEON_AUTH_AUDIENCE into trust lists', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');
    vi.stubEnv('NEON_AUTH_AUDIENCE', 'my-audience');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.trustedAudiences).toContain('my-audience');
  });

  it('merges NEON_AUTH_TRUSTED_* env lists', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');
    vi.stubEnv('NEON_AUTH_TRUSTED_ISSUERS', 'https://legacy-issuer.example');
    vi.stubEnv('NEON_AUTH_TRUSTED_AUDIENCES', 'app-a, app-b');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.trustedIssuers).toContain('https://legacy-issuer.example');
    expect(c.trustedAudiences).toContain('app-a');
    expect(c.trustedAudiences).toContain('app-b');
  });

  it('uses explicit issuer + JWKS without requiring BASE_URL', () => {
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://example.com/.well-known/jwks.json');
    vi.stubEnv('NEON_AUTH_ISSUER', 'https://example.com');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe('https://example.com/.well-known/jwks.json');
    expect(c.trustedIssuers).toEqual(expect.arrayContaining(['https://example.com']));
  });

  it('throws when configuration is incomplete', () => {
    vi.stubEnv('NEON_AUTH_ISSUER', 'https://x');
    delete process.env.NEON_AUTH_JWKS_URL;
    delete process.env.NEON_AUTH_BASE_URL;
    delete process.env.NEON_AUTH_URL;

    expect(() => resolveNeonAuthVerificationConfig()).toThrow(
      /NEON_AUTH_BASE_URL or NEON_AUTH_URL|not configured/
    );
  });
});
