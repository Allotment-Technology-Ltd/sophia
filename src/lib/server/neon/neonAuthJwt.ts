/**
 * Optional Neon Auth (Stack/JWT) verification — wire into `hooks.server.ts` when cutting over from Firebase.
 *
 * Env (set all when enabling):
 * - USE_NEON_AUTH=1
 * - NEON_AUTH_ISSUER
 * - NEON_AUTH_JWKS_URL
 * - NEON_AUTH_AUDIENCE (if your tokens include aud)
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  const url = process.env.NEON_AUTH_JWKS_URL?.trim();
  if (!url) throw new Error('NEON_AUTH_JWKS_URL is not set');
  if (!jwks) jwks = createRemoteJWKSet(new URL(url));
  return jwks;
}

export function isNeonAuthEnabled(): boolean {
  const v = (process.env.USE_NEON_AUTH ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export interface NeonAuthUserClaims {
  sub: string;
  email?: string;
  raw: JWTPayload;
}

/**
 * Verifies a Bearer JWT against Neon Auth JWKS. Returns null if Neon auth is disabled or issuer unset.
 */
export async function verifyNeonAuthJwt(token: string): Promise<NeonAuthUserClaims | null> {
  if (!isNeonAuthEnabled()) return null;
  const issuer = process.env.NEON_AUTH_ISSUER?.trim();
  if (!issuer) {
    throw new Error('USE_NEON_AUTH is set but NEON_AUTH_ISSUER is missing');
  }
  const audience = process.env.NEON_AUTH_AUDIENCE?.trim();
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer,
    ...(audience ? { audience } : {})
  });
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) throw new Error('Neon Auth JWT missing sub');
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  return { sub, email, raw: payload };
}
