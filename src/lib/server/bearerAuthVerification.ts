import type { JWTPayload } from 'jose';
import { isNeonAuthEnabled, verifyNeonAuthJwt } from '$lib/server/neon/neonAuthJwt';

export type BearerAuthProvider = 'neon';

export interface ResolvedBearerProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  authProvider: BearerAuthProvider;
}

function claimsFromJwtPayload(raw: JWTPayload): { displayName: string | null; photoURL: string | null } {
  const displayName =
    typeof raw.name === 'string'
      ? raw.name
      : typeof raw.preferred_username === 'string'
        ? raw.preferred_username
        : null;
  const photoURL =
    typeof raw.picture === 'string'
      ? raw.picture
      : typeof raw.image === 'string'
        ? raw.image
        : null;
  return { displayName, photoURL };
}

/**
 * Verifies a Bearer token for protected API routes (Neon Auth JWT only).
 */
export async function verifyBearerTokenForApi(token: string): Promise<ResolvedBearerProfile> {
  if (!isNeonAuthEnabled()) {
    throw new Error(
      'Neon Auth is not enabled: set NEON_AUTH_BASE_URL or NEON_AUTH_URL (or NEON_AUTH_ISSUER+NEON_AUTH_JWKS_URL), or set USE_NEON_AUTH=1. To disable, set USE_NEON_AUTH=0 explicitly.'
    );
  }

  try {
    const neon = await verifyNeonAuthJwt(token);
    if (!neon) {
      throw new Error('Neon Auth is not enabled.');
    }
    const extra = claimsFromJwtPayload(neon.raw);
    return {
      uid: neon.sub,
      email: neon.email ?? null,
      displayName: extra.displayName,
      photoURL: extra.photoURL,
      authProvider: 'neon'
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid or expired session: ${message}`);
  }
}
