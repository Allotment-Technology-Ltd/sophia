# Ingestion per-stage model matrix (operator)

Use this document to record **evidence-backed** provider/model choices for each ingestion stage. Update after benchmarks ([ingestion-benchmarks.md](./ingestion-benchmarks.md), [ingestion-preset-evidence.md](./ingestion-preset-evidence.md)).

Canonical code defaults live in [`src/lib/ingestionCanonicalPipeline.ts`](../../src/lib/ingestionCanonicalPipeline.ts). Published **Restormel** route steps override planning when pins are not set. **Admin Expand** single-URL runs default to **full Surreal store** in one job; set `stop_before_store: true` on the API only when you explicitly want preview mode (then use sync).

## Stages

| Stage (Restormel `route.stage`) | Primary (Sophia canonical default) | Fallbacks (order) | Measured notes |
|--------------------------------|--------------------------------------|---------------------|----------------|
| `ingestion_extraction` | Vertex `gemini-3-flash-preview` | Vertex `gemini-3.1-pro-preview`, Mistral `mistral-medium-latest`, `mistral-large-latest`, `mistral-small-latest` | Code: `CANONICAL_INGESTION_PRIMARY_MODELS` / `CANONICAL_INGESTION_MODEL_FALLBACKS`. Pins / Restormel routes override. |
| `ingestion_relations` | Vertex `gemini-3-flash-preview` | Same pattern as extraction | Large claim graphs; same canonical chain shape as extraction. |
| `ingestion_grouping` | Vertex `gemini-3-flash-preview` | Same pattern as extraction | Argument grouping batches. |
| `ingestion_validation` | Mistral `mistral-large-latest` | OpenAI `gpt-4o-mini`, `gpt-4o`, Vertex `gemini-3-flash-preview`, Vertex `gemini-3.1-pro-preview` | Default validation primary is **not** the same route as default extraction (second opinion). |
| `ingestion_remediation` | Vertex `gemini-3-flash-preview` | Vertex `gemini-3.1-pro-preview`, Mistral `mistral-medium-latest`, `mistral-large-latest`, `mistral-small-latest` | Post-validation passage-bounded claim repair. |
| `ingestion_json_repair` | Mistral `mistral-medium-latest` | Vertex `gemini-3-flash-preview`, Mistral `mistral-large-latest`, `mistral-small-latest` | Short structured JSON fixes; sensitive-stage allowlist still applies (`ingestionFinetuneLabelerPolicy`). |
| Embeddings (`EMBEDDING_PROVIDER`) | **One** of: Vertex `text-embedding-005` (768-d) or Voyage voyage-4 family (1024-d) | N/A | Not Restormel execution routing today; lock doc: [ingestion-embedding-lock.md](./ingestion-embedding-lock.md). |

Catalog-aware fallback chains for workers when pins are off: [`src/lib/server/ingestCatalogRouting.ts`](../../src/lib/server/ingestCatalogRouting.ts) (Model availability → cost-ordered).

## Bulk SEP (many URLs)

For durable jobs over large lists (e.g. Stanford Encyclopedia), prefer documented env and validation strategy in [ingestion-sep-bulk-preset.md](./ingestion-sep-bulk-preset.md) so cost and quotas stay predictable. For **comparable** SEP benchmark runs and fingerprint logging, see [ingestion-sep-preset-discipline.md](./ingestion-sep-preset-discipline.md).

### Right-sizing models (cheap vs pro)

- **Keep cheap by default:** canonical extraction/relations/grouping/remediation stay on **Vertex Flash** first; **json_repair** stays **Mistral Medium** first; embeddings stay **Voyage lite** or your locked provider ([ingestion-embedding-lock.md](./ingestion-embedding-lock.md)) unless benchmarks show regressions.
- **Spend where evidence shows lift:** fall back to **Vertex Pro** or larger **Mistral** tiers when Flash/Medium hits quality ceilings; **validation** defaults to **Mistral Large** before OpenAI/Vertex tiers in the canonical chain.
- **Restormel pins:** use route steps + admin pins so bulk jobs do not inherit “pro everywhere”; re-benchmark after pin changes ([ingestion-benchmarks.md](./ingestion-benchmarks.md)).

## Vertex lifecycle

Re-check [Vertex model versions](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) when editing this table. Retired IDs must not appear as primaries without a migration entry.

Pin normalization maps legacy pins to current Vertex Gemini **3.x preview** ids (see [`src/lib/server/ingestPinNormalization.ts`](../../src/lib/server/ingestPinNormalization.ts)): e.g. `gemini-1.5-flash` / `gemini-2.0-flash*` / `gemini-2.5-flash` → `gemini-3-flash-preview`; `*-flash-lite` variants → `gemini-3.1-flash-lite-preview`; `gemini-1.5-pro` / `gemini-2.5-pro` → `gemini-3.1-pro-preview`. See [Gemini 3 Flash](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash), [3.1 Pro](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro), [3.1 Flash-Lite](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-lite), and the [lifecycle table](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) (2.0 stable ids retire 2026-06-01; 2.5 GA ids list a “not before 2026-10-16” retirement floor).

## Golden corpus

Run matrix updates against the same sources as [ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md).

For **comparable** faithfulness numbers across runs, pin validation (and optionally extraction) via env — see **Comparable runs (benchmark env)** in that doc. Run reports surface `timingTelemetry.stage_models` (from `[INGEST_TIMING]`) so analytics can filter by the actual validation model used.
