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

## Automation

- Build a full SEP entry list (respect SEP `robots.txt`; one polite fetch of the public contents page):

  `pnpm sep:catalog -- --out data/sep-entry-urls.json`

- Slice that JSON for a golden subset or pilot size, then run `scripts/ingest-batch.ts` / admin **Durable ingestion jobs** as needed.
