# Neon-first rollout (operators)

**Beginner step-by-step:** [neon-migration-walkthrough.md](./neon-migration-walkthrough.md) (console, terminal, Cursor Agent/MCP).

## 1. Schema

Apply SQL in order (Neon SQL editor or `psql`):

1. `drizzle/0000_neon_first.sql` — extensions, ingest orchestration, staging, `sophia_documents`
2. `drizzle/0001_ingest_staging_source.sql` — additive columns if `0000` was applied earlier

Enable the **pgvector** extension in the Neon project if the editor prompts you.

## 2. Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon pooled connection string (required for durable ingest + optional Firestore mirror) |
| `SOPHIA_DATA_BACKEND=neon` | Route `adminDb` through Postgres (`sophia_documents`) instead of Firestore |
| `INGEST_ORCHESTRATION_RUN_ID` | Set automatically on admin ingest workers; do not set manually |

See root `.env.example` for full comments.

**Production (Cloud Run):** GitHub deploy maps Secret Manager **`neon-database-url`** → `DATABASE_URL` and sets **`SOPHIA_DATA_BACKEND=neon`**. One-time `gcloud` steps and IAM are in [neon-migration-walkthrough.md](./neon-migration-walkthrough.md) (Phase 8).

## 3. Durable admin ingestion

With `DATABASE_URL` set (and schema applied):

- Run state, logs, issues, and reports persist in `ingest_runs` / related tables.
- Workers spawned from the admin UI receive `INGEST_ORCHESTRATION_RUN_ID` and write checkpoints to Neon staging instead of (or before falling back to) `data/ingested/*-partial.json`.

## 4. Firestore → Neon documents

For `SOPHIA_DATA_BACKEND=neon`, migrate existing Firestore data into `sophia_documents` before cutting over (or operate dual-write during transition).

Use `scripts/migrate-firestore-to-neon.ts` (dry-run by default). Requires Firebase Admin credentials and `DATABASE_URL`.

## 5. Auth (future)

Neon Auth / Stack Auth cutover is documented in `docs/operations/neon-auth-migration.md`.
