import { browser } from '$app/environment';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();
const useNeonAuth = Boolean(browser && neonAuthUrl);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID
};

const hasFirebaseConfig =
  !!firebaseConfig.apiKey && !!firebaseConfig.authDomain && !!firebaseConfig.projectId;

const firebaseApp =
  browser && hasFirebaseConfig && !useNeonAuth
    ? getApps().length
      ? getApps()[0]!
      : initializeApp(firebaseConfig)
    : null;

const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;

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

/** Same shape as Firebase `Auth` for `auth?.currentUser` in layouts. */
export const auth: { currentUser: SophiaAuthUser | null } = useNeonAuth
  ? {
      get currentUser() {
        return neonCachedUser;
      }
    }
  : (firebaseAuth as unknown as {
      get currentUser(): SophiaAuthUser | null;
    });

export const googleProvider =
  browser && !useNeonAuth && firebaseAuth ? new GoogleAuthProvider() : (null as unknown as GoogleAuthProvider);

if (browser && !useNeonAuth && !hasFirebaseConfig) {
  console.error('Firebase public config is missing at build time. Check VITE_FIREBASE_* env vars in CI.');
}

if (browser && useNeonAuth && !neonAuthUrl) {
  console.error('VITE_NEON_AUTH_URL is missing; Neon Auth client cannot start.');
}

export async function signInWithGoogle() {
  if (!browser) throw new Error('Sign-in is only available in the browser.');
  if (useNeonAuth) {
    const client = await loadNeonAuthClient();
    if (!client) throw new Error('Neon Auth is not configured. Set VITE_NEON_AUTH_URL.');
    const redirectTo = `${window.location.origin}/home`;
    const { error } = await client.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
    return;
  }
  if (!firebaseAuth || !googleProvider) {
    throw new Error('Firebase auth is not configured. Missing VITE_FIREBASE_* values.');
  }
  return signInWithPopup(firebaseAuth, googleProvider);
}

export async function signOutUser() {
  if (!browser) return;
  if (useNeonAuth) {
    const client = await loadNeonAuthClient();
    if (client) {
      await client.signOut();
      neonCachedUser = null;
    }
    return;
  }
  if (!firebaseAuth) throw new Error('Firebase auth is not configured.');
  return signOut(firebaseAuth);
}

export function onAuthChange(callback: (user: SophiaAuthUser | null) => void) {
  if (!browser) return () => {};
  if (useNeonAuth) {
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
  if (!firebaseAuth) return () => {};
  return onAuthStateChanged(firebaseAuth, (user) => {
    callback(
      user
        ? {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
          }
        : null
    );
  });
}

export async function getIdToken(): Promise<string | null> {
  if (!browser) return null;
  if (useNeonAuth) {
    const client = await loadNeonAuthClient();
    if (!client) return null;
    const { data, error } = await client.getSession();
    if (error || !data.session) return null;
    return data.session.access_token ?? null;
  }
  if (!firebaseAuth) return null;
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}
