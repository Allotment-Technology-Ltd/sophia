/**
 * Browser auth: Neon Auth only (Better Auth via @neondatabase/neon-js).
 *
 * If Google’s account chooser says “Continue to …firebaseapp.com”, the Firebase JS SDK is
 * not involved — Neon is redirecting to Google using an OAuth client ID that still belongs
 * to the Firebase project (or Neon Auth → Google is configured with that client). Fix it in
 * Neon Console (Auth → Google) with a dedicated Web OAuth client and correct redirect URIs;
 * see docs/local/operations/neon-auth-migration.md when the maintainer doc pack is present.
 */
import { browser } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';

/** Runtime `PUBLIC_NEON_AUTH_URL` (Cloud Run) or build-time `VITE_NEON_AUTH_URL` (Docker build). */
function neonAuthUrl(): string | undefined {
  const fromRuntime = publicEnv.PUBLIC_NEON_AUTH_URL?.trim();
  const fromVite = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();
  return fromRuntime || fromVite || undefined;
}

/** Firebase-shaped user for existing Svelte code (`uid`, `email`, …). */
export type SophiaAuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

function mapNeonUserToCompat(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): SophiaAuthUser {
  const meta = user.user_metadata ?? {};
  const displayName =
    (typeof meta.displayName === 'string' && meta.displayName) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  const photoURL =
    (typeof meta.profileImageUrl === 'string' && meta.profileImageUrl) ||
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    null;
  return {
    uid: user.id,
    email: user.email ?? null,
    displayName,
    photoURL
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let neonAuthClientPromise: Promise<any> | null = null;
let neonCachedUser: SophiaAuthUser | null = null;

async function loadNeonAuthClient() {
  const url = neonAuthUrl();
  if (!browser || !url) return null;
  if (!neonAuthClientPromise) {
    neonAuthClientPromise = (async () => {
      const { createAuthClient } = await import('@neondatabase/neon-js/auth');
      const { SupabaseAuthAdapter } = await import('@neondatabase/neon-js/auth/vanilla/adapters');
      return createAuthClient(url, {
        adapter: SupabaseAuthAdapter()
      });
    })();
  }
  return neonAuthClientPromise;
}

if (browser && !neonAuthUrl()) {
  console.error('PUBLIC_NEON_AUTH_URL or VITE_NEON_AUTH_URL is missing; Neon Auth client cannot start.');
}

/** Same shape as legacy `Auth` for `auth?.currentUser` in layouts. */
export const auth: { currentUser: SophiaAuthUser | null } = {
  get currentUser() {
    return neonCachedUser;
  }
};

/** @deprecated No-op for Neon OAuth; kept so imports do not break. */
export const googleProvider = null;

export async function signInWithGoogle(options?: { redirectPath?: string }) {
  if (!browser) throw new Error('Sign-in is only available in the browser.');
  const client = await loadNeonAuthClient();
  if (!client) {
    throw new Error(
      'Neon Auth is not configured. Set PUBLIC_NEON_AUTH_URL at runtime or VITE_NEON_AUTH_URL at build time.'
    );
  }
  const raw = options?.redirectPath?.trim();
  const path =
    raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/home';
  const redirectTo = `${window.location.origin}${path}`;
  const { error } = await client.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
}

export async function signOutUser() {
  if (!browser) return;
  const client = await loadNeonAuthClient();
  if (client) {
    await client.signOut();
    neonCachedUser = null;
  }
}

export function onAuthChange(callback: (user: SophiaAuthUser | null) => void) {
  if (!browser) return () => {};
  let innerUnsub: (() => void) | null = null;
  const ready = loadNeonAuthClient().then((client) => {
    if (!client) return;
    const { data } = client.onAuthStateChange(
      (_event: string, session: { user?: Parameters<typeof mapNeonUserToCompat>[0] } | null) => {
        const u = session?.user;
        neonCachedUser = u ? mapNeonUserToCompat(u) : null;
        callback(neonCachedUser);
      }
    );
    innerUnsub = () => data.subscription.unsubscribe();
  });
  void ready.catch(() => {});
  return () => {
    void ready.then(() => innerUnsub?.());
  };
}

/**
 * JWT used for `Authorization: Bearer` on our API. Prefer the Neon auth adapter’s
 * {@link getJWTToken} (same token Better Auth issues for API use); fall back to a forced session fetch
 * with `access_token` (Supabase-shaped session) when needed.
 */
export async function getIdToken(): Promise<string | null> {
  if (!browser) return null;
  const client = await loadNeonAuthClient();
  if (!client) return null;
  const withJwt = client as { getJWTToken?: () => Promise<string | null> };
  if (typeof withJwt.getJWTToken === 'function') {
    const direct = await withJwt.getJWTToken();
    if (direct) return direct;
  }
  const withSession = client as {
    getSession?: (o?: { forceFetch?: boolean }) => Promise<{
      data: { session: { access_token?: string | null } | null } | null;
      error: Error | null;
    }>;
  };
  if (typeof withSession.getSession === 'function') {
    const { data, error } = await withSession.getSession({ forceFetch: true });
    if (!error && data?.session) {
      return data.session.access_token ?? null;
    }
  }
  return null;
}
