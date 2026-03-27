/**
 * When DATABASE_URL is set and SOPHIA_DATA_BACKEND=neon, Sophia reads/writes
 * operational documents via Postgres (`sophia_documents`) instead of Firestore.
 */
export function useNeonDatastore(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  const mode = (process.env.SOPHIA_DATA_BACKEND ?? 'firestore').trim().toLowerCase();
  return Boolean(url && mode === 'neon');
}

/** Ingest orchestration + staging always uses Neon when DATABASE_URL is set. */
export function isNeonIngestPersistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
