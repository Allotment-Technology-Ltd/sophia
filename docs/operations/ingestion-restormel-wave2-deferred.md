# Restormel extraction — Wave 2 (deferred)

Wave 1 proves ingestion in **Sophia** (jobs, workers, UI, embeddings, benchmarks). The following are **explicitly deferred** until success criteria are met:

1. **Restormel Keys OpenAPI** for a dedicated *bulk ingestion* workload (extra routes, job metadata, policies).
2. **Config refactor (Phase 0 of extraction)** — consolidate `INGEST_*` env pins, operator model pins, `RESTORMEL_*`, and catalog merge rules into a single documented configuration layer.

Until then, keep using published Dashboard APIs per [upstream-first](../../.cursor/rules/restormel-integration-upstream-first.mdc) and avoid Sophia-only undocumented routing shortcuts.
