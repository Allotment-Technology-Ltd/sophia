import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// On Cloud Run, Application Default Credentials work automatically
// Otherwise, set GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
if (!getApps().length) {
  initializeApp();
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
