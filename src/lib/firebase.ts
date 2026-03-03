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

// Only initialize Firebase in the browser
const app = browser ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null as any;
export const googleProvider = browser ? new GoogleAuthProvider() : null as any;

export async function signInWithGoogle() {
  if (!browser || !auth) throw new Error('Firebase not available');
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  if (!browser || !auth) throw new Error('Firebase not available');
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
