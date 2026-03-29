/**
 * Neon Auth (Better Auth) JWT verification for protected API routes.
 *
 * Configure one of:
 * - **Simple:** `USE_NEON_AUTH=1` and `NEON_AUTH_BASE_URL` (value from Neon Console / API `base_url`, e.g. `https://….neonauth….neon.tech/neondb/auth`).
 *   JWKS URL and issuer/audience are derived per [Neon JWT docs](https://neon.com/docs/auth/guides/plugins/jwt).
 * - **Explicit:** `NEON_AUTH_ISSUER` (JWT `iss` — the **origin** of the auth host, e.g. `https://ep-….aws.neon.tech`) +
 *   `NEON_AUTH_JWKS_URL` + optional `NEON_AUTH_AUDIENCE`.
 *
 * Print `base_url` / `jwks_url` for your branch: `pnpm neon:auth-env` (needs `NEON_API_KEY` + project/branch ids).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwksForUrl(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByUrl.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, jwks);
  }
  return jwks;
}

export function isNeonAuthEnabled(): boolean {
  const v = (process.env.USE_NEON_AUTH ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Resolved verification parameters (for tests and debugging). */
export interface NeonAuthVerificationConfig {
  jwksUrl: string;
  issuer: string;
  audience: string | undefined;
}

/**
 * Resolves JWKS URL, issuer, and optional audience from env.
 * @throws If Neon auth is enabled but configuration is incomplete.
 */
export function resolveNeonAuthVerificationConfig(): NeonAuthVerificationConfig {
  const base = process.env.NEON_AUTH_BASE_URL?.trim();
  const explicitIssuer = process.env.NEON_AUTH_ISSUER?.trim();
  const explicitJwks = process.env.NEON_AUTH_JWKS_URL?.trim();
  const explicitAudience = process.env.NEON_AUTH_AUDIENCE?.trim();

  if (base) {
    const trimmed = base.replace(/\/$/, '');
    let origin: string;
    try {
      origin = new URL(trimmed).origin;
    } catch {
      throw new Error('NEON_AUTH_BASE_URL is not a valid URL');
    }
    const jwksUrl = explicitJwks || `${trimmed}/.well-known/jwks.json`;
    const issuer = explicitIssuer || origin;
    // Neon Auth JWTs use aud = origin (same as iss host); default when using base URL.
    const audience = explicitAudience || origin;
    return { jwksUrl, issuer, audience };
  }

  if (explicitIssuer && explicitJwks) {
    return {
      jwksUrl: explicitJwks,
      issuer: explicitIssuer,
      audience: explicitAudience || undefined
    };
  }

  throw new Error(
    'USE_NEON_AUTH is set but auth is not configured: set NEON_AUTH_BASE_URL (from Neon API `base_url`) or both NEON_AUTH_ISSUER and NEON_AUTH_JWKS_URL'
  );
}

export interface NeonAuthUserClaims {
  sub: string;
  email?: string;
  raw: JWTPayload;
}

/**
 * Verifies a Bearer JWT against Neon Auth JWKS. Returns null if Neon auth is disabled.
 */
export async function verifyNeonAuthJwt(token: string): Promise<NeonAuthUserClaims | null> {
  if (!isNeonAuthEnabled()) return null;
  const { jwksUrl, issuer, audience } = resolveNeonAuthVerificationConfig();
  const { payload } = await jwtVerify(token, getJwksForUrl(jwksUrl), {
    issuer,
    ...(audience ? { audience } : {})
  });
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) throw new Error('Neon Auth JWT missing sub');
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  return { sub, email, raw: payload };
}
