/**
 * Default for `ADMIN_INGEST_MAX_CONCURRENT` when unset — lower than “one per core” to avoid
 * provider rate limits, embedding contention, and noisy neighbour effects on shared hosts.
 */
export const DEFAULT_ADMIN_INGEST_MAX_CONCURRENT = 2;

/**
 * Max parallel child runs per durable ingestion job (admin UI + API clamp).
 * Keep aligned with the typical global cap so pending URLs queue instead of failing at launch.
 */
export const MAX_DURABLE_INGEST_JOB_CONCURRENCY = DEFAULT_ADMIN_INGEST_MAX_CONCURRENT;
