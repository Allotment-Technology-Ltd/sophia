/**
 * Default for `ADMIN_INGEST_MAX_CONCURRENT` when unset — tuned below raw CPU count to limit
 * provider rate limits, embedding contention, and noisy neighbour effects on shared hosts.
 * Cloud Run `sophia-ingest-worker` sets `ADMIN_INGEST_MAX_CONCURRENT=3` explicitly in deploy scripts.
 */
export const DEFAULT_ADMIN_INGEST_MAX_CONCURRENT = 3;

/**
 * Max parallel child runs per durable ingestion job (admin UI + API clamp).
 * Keep aligned with the typical global cap so pending URLs queue instead of failing at launch.
 */
export const MAX_DURABLE_INGEST_JOB_CONCURRENCY = DEFAULT_ADMIN_INGEST_MAX_CONCURRENT;
