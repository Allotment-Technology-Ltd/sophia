# Embedding lock (SEP-scale)

Run **one** embedding stack in production so Surreal vector geometry, ingestion runtime, and operator dashboards stay aligned.

## Operator choice

Set **`EMBEDDING_PROVIDER`** to either:

- **`vertex`** — `text-embedding-005`, **768** dimensions (GCP / Vertex; aligns with credits on `sophia-488807` when using managed APIs).
- **`voyage`** — Voyage voyage-4 family, **1024** dimensions (API key).

Do not flip providers without a **re-embed** plan; mixed dimensions in the same index break retrieval.

## Surreal

After any provider or model change:

1. Run `pnpm db:audit-surreal-vector` (optionally with `SURREAL_VECTOR_AUDIT_STRICT=1` in CI).
2. If dimensions changed, recreate or migrate the vector index and run `scripts/reembed-corpus.ts` as appropriate.

## Restormel Keys

Publish an **`ingestion_embedding`** route whose model matches the runtime provider (Vertex vs Voyage) and dimension. Optional pin: **`RESTORMEL_INGEST_EMBEDDING_ROUTE_ID`** in `.env`.

## Health check

`GET /api/admin/ingest/embedding-health` compares Restormel route metadata with the active embedding provider.
