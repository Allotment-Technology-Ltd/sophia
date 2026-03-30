/**
 * Neon Postgres document store (`sophia_documents` table) exposed through a Firestore-shaped API.
 * This is not Google Firestore; the compat layer keeps collection/doc paths stable for BYOK, billing, users, etc.
 */
import { loadServerEnv } from './env';
import { createNeonFirestoreCompat } from './neon/neonFirestoreCompat';
import { useNeonDatastore } from './neon/datastore';

loadServerEnv();

if (!useNeonDatastore()) {
  throw new Error(
    'DATABASE_URL is required and SOPHIA_DATA_BACKEND must be `neon` (default). Google Firestore has been removed; use Neon-backed sophia_documents only.'
  );
}

export const sophiaDocumentsDb = createNeonFirestoreCompat();
