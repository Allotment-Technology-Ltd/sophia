import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { browser } from '$app/environment';

// Firebase client configuration - env vars populated from Cloud Run secrets
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const hasFirebaseConfig =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId;

// Only initialize Firebase in the browser
const app = browser && hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null as any;
export const googleProvider = browser ? new GoogleAuthProvider() : null as any;

if (browser && !hasFirebaseConfig) {
  console.error('Firebase public config is missing at build time. Check VITE_FIREBASE_* env vars in CI.');
}

export async function signInWithGoogle() {
  if (!browser || !auth) {
    throw new Error('Firebase auth is not configured. Missing VITE_FIREBASE_* values.');
  }
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  if (!browser || !auth) throw new Error('Firebase auth is not configured.');
  return signOut(auth);
}

export function onAuthChange(callback: (user: any) => void) {
  if (!browser || !auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken(): Promise<string | null> {
  if (!browser || !auth) return null;
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}
