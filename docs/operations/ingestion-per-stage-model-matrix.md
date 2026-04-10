# Ingestion per-stage model matrix (operator)

Use this document to record **evidence-backed** provider/model choices for each ingestion stage. Update after benchmarks ([ingestion-benchmarks.md](./ingestion-benchmarks.md), [ingestion-preset-evidence.md](./ingestion-preset-evidence.md)).

Canonical code defaults live in [`src/lib/ingestionCanonicalPipeline.ts`](../../src/lib/ingestionCanonicalPipeline.ts). Published **Restormel** route steps override planning when pins are not set.

## Stages

| Stage (Restormel `route.stage`) | Primary (Sophia default) | Fallbacks | Measured notes |
|--------------------------------|--------------------------|-----------|----------------|
| `ingestion_extraction` | | | |
| `ingestion_relations` | | | |
| `ingestion_grouping` | | | |
| `ingestion_validation` | | | |
| `ingestion_json_repair` | | | |
| Embeddings (`EMBEDDING_PROVIDER`) | | | N/A for Restormel execution routing today |

## Vertex lifecycle

Re-check [Vertex model versions](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) when editing this table. Retired IDs must not appear as primaries without a migration entry.

## Golden corpus

Run matrix updates against the same sources as [ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md).
