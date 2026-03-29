import type { JWTPayload } from 'jose';
import { adminAuth } from '$lib/server/firebase-admin';
import { isNeonAuthEnabled, verifyNeonAuthJwt } from '$lib/server/neon/neonAuthJwt';

export type BearerAuthProvider = 'firebase' | 'neon';

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
 * Verifies a Bearer token for protected API routes. When `USE_NEON_AUTH` is enabled, tries Neon Auth JWT
 * first, then Firebase ID tokens (legacy clients / mis-ordered tokens).
 */
export async function verifyBearerTokenForApi(token: string): Promise<ResolvedBearerProfile> {
  if (isNeonAuthEnabled()) {
    try {
      const neon = await verifyNeonAuthJwt(token);
      if (neon) {
        const extra = claimsFromJwtPayload(neon.raw);
        return {
          uid: neon.sub,
          email: neon.email ?? null,
          displayName: extra.displayName,
          photoURL: extra.photoURL,
          authProvider: 'neon'
        };
      }
    } catch {
      // Not a valid Neon JWT; try Firebase (dual migration / legacy clients).
    }
  }

  const decoded = await adminAuth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
    photoURL: decoded.picture ?? null,
    authProvider: 'firebase'
  };
}
