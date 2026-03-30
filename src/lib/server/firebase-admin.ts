/**
 * Operational document store: Neon Postgres (`sophia_documents`) only.
 * The module name is historical; Firebase is not used at runtime.
 */
import { loadServerEnv } from './env';
import { createNeonFirestoreCompat } from './neon/neonFirestoreCompat';
import { useNeonDatastore } from './neon/datastore';

loadServerEnv();

if (!useNeonDatastore()) {
  throw new Error(
    'DATABASE_URL is required and SOPHIA_DATA_BACKEND must be `neon` (default). Google Firestore / Firebase Admin have been removed.'
  );
}

export const adminDb = createNeonFirestoreCompat();
