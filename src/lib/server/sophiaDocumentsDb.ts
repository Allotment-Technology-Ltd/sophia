/**
 * Neon Postgres document store (`sophia_documents` table) exposed through a Firestore-shaped API.
 * This is not Google Firestore; the compat layer keeps collection/doc paths stable for BYOK, billing, users, etc.
 *
 * The underlying client is created lazily on first property access so that importing this module
 * (e.g. via `authRoles` in hooks) does not crash the dev server when `DATABASE_URL` is missing
 * from `.env`. Set `DATABASE_URL` in `.env` or `.env.local` for local manual testing.
 */
import { loadServerEnv } from './env';
import { createNeonFirestoreCompat } from './neon/neonFirestoreCompat';
import { useNeonDatastore } from './neon/datastore';

loadServerEnv();

const NEON_REQUIRED_MSG =
  'DATABASE_URL is required and SOPHIA_DATA_BACKEND must be `neon` (default). Google Firestore has been removed; use Neon-backed sophia_documents only.';

type SophiaDb = ReturnType<typeof createNeonFirestoreCompat>;
let _sophiaDocuments: SophiaDb | null = null;

function getSophiaDocumentsOrThrow(): SophiaDb {
  if (!useNeonDatastore()) {
    throw new Error(NEON_REQUIRED_MSG);
  }
  if (!_sophiaDocuments) {
    _sophiaDocuments = createNeonFirestoreCompat();
  }
  return _sophiaDocuments;
}

export const sophiaDocumentsDb = new Proxy({} as SophiaDb, {
  get(_t, prop, receiver) {
    return Reflect.get(getSophiaDocumentsOrThrow(), prop, receiver);
  }
});
