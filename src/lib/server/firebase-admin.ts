import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { loadServerEnv } from './env';
import { createNeonFirestoreCompat } from './neon/neonFirestoreCompat';
import { useNeonDatastore } from './neon/datastore';

// On Cloud Run, Application Default Credentials work automatically.
// Local: `pnpm dev` runs scripts/dev.mjs, which resolves GOOGLE_APPLICATION_CREDENTIALS from .env
// or conventional paths under secrets/ — see .env.example.
loadServerEnv();

function resolveFirebaseProjectId(): string | undefined {
  const direct =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (direct) return direct;

  const firebaseConfig = process.env.FIREBASE_CONFIG?.trim();
  if (!firebaseConfig) return undefined;
  try {
    const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
    return parsed.projectId?.trim() || undefined;
  } catch {
    return undefined;
  }
}

if (!getApps().length) {
  const projectId = resolveFirebaseProjectId();
  if (projectId) {
    initializeApp({ projectId });
  } else {
    initializeApp();
  }
}

export const adminAuth = getAuth();
export const adminDb = useNeonDatastore() ? createNeonFirestoreCompat() : getFirestore();
