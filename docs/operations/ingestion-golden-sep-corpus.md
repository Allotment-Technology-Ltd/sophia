# Golden SEP corpus (ingestion quality gate)

Before large waves, run ingestion benchmarks on a **small fixed set** of Stanford Encyclopedia entries (plus one non-SEP control if useful). Record results in [ingestion-per-stage-model-matrix.md](./ingestion-per-stage-model-matrix.md).

## Suggested starter set

- One medium-length analytic entry (e.g. a core topic in your target domain).
- One long or heavily cross-linked entry.
- One entry with unusual structure or heavy bibliography.

Exact URLs are operator-chosen; keep them stable for regression comparison.

## Procedure

1. Follow [ingestion-benchmarks.md](./ingestion-benchmarks.md).
2. Capture `[INGEST_TIMING]`, issue counts, and cost estimates.
3. **Hold** a preset or catalog promotion if `json_repair` or failure rates spike versus the prior baseline.

## Comparable runs (benchmark env)

Faithfulness scores are only comparable when **validation** (and, for stability, **extraction**) use the same provider/model across runs. Catalog routing and fallbacks can otherwise change the active tier between jobs.

**Recommended for golden SEP regression runs:**

| Variable | Purpose |
|----------|---------|
| `INGEST_PIN_PROVIDER_VALIDATION` | e.g. `vertex` |
| `INGEST_PIN_MODEL_VALIDATION` | e.g. `gemini-2.5-flash` (see pin normalization below) |
| `INGEST_PIN_PROVIDER_EXTRACTION` | optional; e.g. `openai` |
| `INGEST_PIN_MODEL_EXTRACTION` | optional; e.g. `gpt-4o-mini` |
| `INGEST_NO_MODEL_FALLBACK` | Set to `1` if you need a **single** model per stage (no chain fallback on failure) |

Legacy Vertex Gemini IDs in pins are normalized at parse time ([`src/lib/server/ingestPinNormalization.ts`](../../src/lib/server/ingestPinNormalization.ts)) (e.g. `gemini-1.5-flash` → `gemini-2.5-flash`).

**Long entries:** validation feeds an excerpt built from claim spans (see `buildValidationSourceSnippet` and `VALIDATION_BATCH_SOURCE_MAX_CHARS` / `VALIDATION_BATCH_SOURCE_CONTEXT_CHARS`). Tune those only when benchmarking very long span unions; default behavior uses center-weighted truncation inside the span window.

After a run, Firestore / Neon `ingestion_run_reports` include **`timingTelemetry.stage_models`** — last successful `provider/model` per stage from `[INGEST_TIMING]` — so you can confirm which model produced validation scores.

## Automation

- Build a full SEP entry list (respect SEP `robots.txt`; one polite fetch of the public contents page):

  `pnpm sep:catalog -- --out data/sep-entry-urls.json`

- Slice that JSON for a golden subset or pilot size, then run `scripts/ingest-batch.ts` / admin **Durable ingestion jobs** as needed.
