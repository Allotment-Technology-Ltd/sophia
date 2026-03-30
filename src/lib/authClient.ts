/**
 * Browser auth: Neon Auth only (Better Auth via @neondatabase/neon-js).
 */
import { browser } from '$app/environment';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();

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
  if (!browser || !neonAuthUrl) return null;
  if (!neonAuthClientPromise) {
    neonAuthClientPromise = (async () => {
      const { createAuthClient } = await import('@neondatabase/neon-js/auth');
      const { SupabaseAuthAdapter } = await import('@neondatabase/neon-js/auth/vanilla/adapters');
      return createAuthClient(neonAuthUrl, {
        adapter: SupabaseAuthAdapter()
      });
    })();
  }
  return neonAuthClientPromise;
}

if (browser && !neonAuthUrl) {
  console.error('VITE_NEON_AUTH_URL is missing; Neon Auth client cannot start.');
}

/** Same shape as legacy `Auth` for `auth?.currentUser` in layouts. */
export const auth: { currentUser: SophiaAuthUser | null } = {
  get currentUser() {
    return neonCachedUser;
  }
};

/** @deprecated No-op for Neon OAuth; kept so imports do not break. */
export const googleProvider = null;

export async function signInWithGoogle() {
  if (!browser) throw new Error('Sign-in is only available in the browser.');
  const client = await loadNeonAuthClient();
  if (!client) throw new Error('Neon Auth is not configured. Set VITE_NEON_AUTH_URL.');
  const redirectTo = `${window.location.origin}/home`;
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

export async function getIdToken(): Promise<string | null> {
  if (!browser) return null;
  const client = await loadNeonAuthClient();
  if (!client) return null;
  const { data, error } = await client.getSession();
  if (error || !data.session) return null;
  return data.session.access_token ?? null;
}
