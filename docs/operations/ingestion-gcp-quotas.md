# GCP quotas and billing alerts (ingestion-heavy)

Use this when running large durable jobs (e.g. SEP) or multiple concurrent `ingest.ts` workers.

## Vertex AI (Gemini, embeddings)

- In **Google Cloud Console** → **Vertex AI** → **Quotas**, monitor requests per minute and token limits for the models you use (`gemini-3-*`, `gemini-2.5-*` if still pinned, `text-embedding-005`, etc.).
- Raise quotas **before** scaling `ADMIN_INGEST_MAX_CONCURRENT` or enabling **`INGEST_GLOBAL_CONCURRENCY_GATE`**.

## Cloud Run

- **Concurrency** and **CPU/memory** on the service that runs admin + workers: avoid OOM on long `ingest.ts` runs.
- **Timeout**: ensure the request or job timeout exceeds your longest single-source ingest.

## Billing

- Set **budgets** and **alerts** on the billing account (e.g. 50% / 90% thresholds) so quota or runaway jobs are visible early.

## Neon (Postgres)

- **Connection limits** on the Neon tier: many parallel workers increase pooled connections.
- Apply migrations for optional gates: `ingest_concurrency_gate`, `ingest_phase_gate`.

## Environment knobs (Sophia)

| Variable | Role |
|----------|------|
| `ADMIN_INGEST_MAX_CONCURRENT` | Per-process or global max parallel child ingests (with `INGEST_GLOBAL_CONCURRENCY_GATE`). |
| `INGEST_GLOBAL_CONCURRENCY_GATE` | When `1`, use Neon `ingest_concurrency_gate` across instances. |
| `INGEST_PHASE_EMBED_MAX_CONCURRENT` | Optional cap on concurrent Stage 4 embedding sections across runs. |
| `VERTEX_EMBED_BATCH_DELAY_MS` | Throttle embedding batches vs provider limits. |
