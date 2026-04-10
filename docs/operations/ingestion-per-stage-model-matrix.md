# Ingestion per-stage model matrix (operator)

Use this document to record **evidence-backed** provider/model choices for each ingestion stage. Update after benchmarks ([ingestion-benchmarks.md](./ingestion-benchmarks.md), [ingestion-preset-evidence.md](./ingestion-preset-evidence.md)).

Canonical code defaults live in [`src/lib/ingestionCanonicalPipeline.ts`](../../src/lib/ingestionCanonicalPipeline.ts). Published **Restormel** route steps override planning when pins are not set. **Admin Expand** single-URL runs default to **full Surreal store** in one job; set `stop_before_store: true` on the API only when you explicitly want preview mode (then use sync).

## Stages

| Stage (Restormel `route.stage`) | Primary (Sophia default) | Fallbacks (order) | Measured notes |
|--------------------------------|--------------------------|---------------------|----------------|
| `ingestion_extraction` | OpenAI `gpt-4o-mini` | `gpt-4o`, Vertex `gemini-2.5-flash` | Structured JSON; mini first for cost. |
| `ingestion_relations` | OpenAI `gpt-4o` | `gpt-4-turbo`, Vertex `gemini-2.5-pro` | Large claim graphs; TPM headroom. |
| `ingestion_grouping` | OpenAI `gpt-4o` | `gpt-4-turbo`, Vertex `gemini-2.5-pro` | Argument grouping batches. |
| `ingestion_validation` | Vertex `gemini-2.5-flash` | `gpt-4o`, `gpt-4o-mini`, `gemini-2.5-pro` | Cross-vendor check vs extraction path. |
| `ingestion_json_repair` | Vertex `gemini-2.5-flash` | `gpt-4o-mini`, `gemini-2.5-pro` | Fast repair on malformed JSON. |
| Embeddings (`EMBEDDING_PROVIDER`) | **One** of: Vertex `text-embedding-005` (768-d) or Voyage voyage-4 family (1024-d) | N/A | Not Restormel execution routing today; lock doc: [ingestion-embedding-lock.md](./ingestion-embedding-lock.md). |

Catalog-aware fallback chains for workers when pins are off: [`src/lib/server/ingestCatalogRouting.ts`](../../src/lib/server/ingestCatalogRouting.ts) (Model availability → cost-ordered).

## Vertex lifecycle

Re-check [Vertex model versions](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) when editing this table. Retired IDs must not appear as primaries without a migration entry.

Pin normalization maps legacy pins to GA IDs (see [`src/lib/server/ingestPinNormalization.ts`](../../src/lib/server/ingestPinNormalization.ts)): e.g. `gemini-1.5-*` → `gemini-2.5-*`, `gemini-2.0-flash` / `gemini-2.0-flash-001` → `gemini-2.5-flash`.

## Golden corpus

Run matrix updates against the same sources as [ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md).
