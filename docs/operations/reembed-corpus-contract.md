# Corpus re-embed job contract (Sophia)

This documents the **operator boundary** for migrating Surreal `claim.embedding` to the active runtime dimension (e.g. **1024** for Voyage when `EMBEDDING_PROVIDER=voyage`). The implementation is Neon-backed (`reembed_jobs`, `reembed_job_events`) with work advanced by `tickReembedJob` from the **ingestion-job-poller** or admin **Advance one step**.

## Productization note (Restormel)

A future **Restormel-grade** “batch re-embed” product could expose the same logical contract: `createJob` → `getJob` / event stream → `cancel`; worker ticks are out-of-band. Sophia keeps secrets server-side; any upstream API would mirror this shape without embedding provider keys in the browser.

## Operational checklist

1. **Inventory**: `pnpm exec tsx --env-file=.env scripts/corpus-embedding-inventory.ts` or GET `/api/admin/reembed/inventory` (owner).
2. **Backup**: `tsx --env-file=.env scripts/backup-vectors.ts` — snapshot before index removal.
3. **Config**: Align `EMBEDDING_PROVIDER` / Restormel ingestion embedding route with the target space; see `docs/operations/ingestion-embedding-lock.md`.
4. **During migration**: `INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM=1` (or unset default) so ingest is not blocked by mixed dims.
5. **After corpus is uniform**: set `INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM=0` to re-enable strict checks.
6. **Validation**: `pnpm db:audit-surreal-vector` with `SURREAL_VECTOR_AUDIT_STRICT=1` where appropriate; admin embedding-health JSON.

## Neon staging vectors (optional)

`ingest_staging_claims.embedding` in Neon remains **768**-shaped in schema until a separate Drizzle migration widens it. Re-embed jobs operate on **Surreal** claims only; staging checkpoints with embeddings are orthogonal.
