/**
 * When DATABASE_URL is set, operational documents use Postgres (`sophia_documents`) by default.
 * Set `SOPHIA_DATA_BACKEND=firestore` only if you need Firestore for admin data while Neon handles ingest.
 */
export function useNeonDatastore(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return false;
  const explicit = process.env.SOPHIA_DATA_BACKEND?.trim();
  const mode = (explicit && explicit.length > 0 ? explicit : 'neon').toLowerCase();
  return mode === 'neon';
}

/** Ingest orchestration + staging always uses Neon when DATABASE_URL is set. */
export function isNeonIngestPersistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
