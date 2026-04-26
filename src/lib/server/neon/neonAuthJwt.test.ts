import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNeonAuthVerificationConfig } from './neonAuthJwt';

describe('resolveNeonAuthVerificationConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives JWKS, issuer, and audience from NEON_AUTH_URL when BASE_URL is unset', () => {
    vi.stubEnv('NEON_AUTH_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe(
      'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json'
    );
  });

  it('derives JWKS, issuer, and audience from NEON_AUTH_BASE_URL', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe(
      'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json'
    );
    expect(c.issuer).toBe('https://ep-x.neonauth.us-east-1.aws.neon.tech');
    expect(c.audience).toBe('https://ep-x.neonauth.us-east-1.aws.neon.tech');
  });

  it('allows explicit JWKS URL override when BASE_URL is set', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://custom.example/jwks.json');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe('https://custom.example/jwks.json');
    expect(c.issuer).toBe('https://ep-x.neonauth.us-east-1.aws.neon.tech');
    expect(c.audience).toBe('https://ep-x.neonauth.us-east-1.aws.neon.tech');
  });

  it('respects NEON_AUTH_AUDIENCE when BASE_URL is set', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://ep-x.neonauth.us-east-1.aws.neon.tech/neondb/auth');
    vi.stubEnv('NEON_AUTH_AUDIENCE', 'my-audience');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.audience).toBe('my-audience');
  });

  it('uses explicit issuer + JWKS without requiring BASE_URL', () => {
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://example.com/.well-known/jwks.json');
    vi.stubEnv('NEON_AUTH_ISSUER', 'https://example.com');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.jwksUrl).toBe('https://example.com/.well-known/jwks.json');
    expect(c.issuer).toBe('https://example.com');
    expect(c.audience).toBeUndefined();
  });

  it('includes explicit audience with issuer + JWKS mode', () => {
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://example.com/jwks');
    vi.stubEnv('NEON_AUTH_ISSUER', 'https://example.com');
    vi.stubEnv('NEON_AUTH_AUDIENCE', 'https://example.com');

    const c = resolveNeonAuthVerificationConfig();
    expect(c.audience).toBe('https://example.com');
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
