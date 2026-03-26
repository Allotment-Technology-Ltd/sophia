# Ingestion benchmarks (operator)

Use this checklist to compare **before/after** throughput work: telemetry in the worker, admin UI, and Firestore `ingestion_run_reports`.

## What to capture

1. **Wall time** — total run time and per-stage ms from `[INGEST_TIMING]` / `timingTelemetry`.
2. **Retries** — ingest/fetch/sync auto-retries and model retry/backoff counts in timing JSON.
3. **Splits / repair** — `batch_splits`, JSON repair counts (signals prompt or batch pressure).
4. **Failures** — exit codes, `issues` summary, routing degraded flags in the run report.
5. **Cost** — Restormel / provider dashboards (optional spot-check vs pre-scan estimates).

## Corpus sizes

- **Small** — short article or single SEP-style entry (smoke + fast iteration).
- **Medium** — typical production source (representative token counts).
- **Large** — stress case (high claim count, long relations phase).

## Procedure

1. Set `ADMIN_INGEST_RUN_REAL=1` and required Surreal/Firebase credentials.
2. Run the **same source** twice on the same commit (cold vs warm cache optional note).
3. Copy **`[INGEST_TIMING]`** from the admin raw log or open the run report’s `timingTelemetry` in Firestore.
4. Record **preset** (budget/balanced/complexity), **validation on/off**, and **batch overrides** (relations overlap, embed batch size).
5. Compare **stage_ms**, **embed_wall_ms**, **store_wall_ms**, retry totals, and issue kinds (`json_repair`, `batch_split`).

## Release gate (suggested)

- **Ship** when median wall time improves on medium corpus **without** a proportional rise in `json_repair` / failed stages, and failure/retry rates stay within prior band.
- **Hold** if large-corpus runs show unstable store stage or rising truncation splits without a documented tuning follow-up.

## Related env knobs

| Variable | Purpose |
|----------|---------|
| `ADMIN_INGEST_MAX_CONCURRENT` | Cap parallel real ingest workers (429 when full). |
| `INGEST_PASSAGE_INSERT_CONCURRENCY` | Parallel Surreal passage writes at stage 6. |
| `VERTEX_EMBED_BATCH_DELAY_MS` | Pause between Vertex embedding batches. |
| `RELATIONS_BATCH_OVERLAP_CLAIMS` | Overlap between relation batches (worker / batch overrides). |

## Operator BYOK

Operational keys live on the first `OWNER_UIDS` Firebase UID and merge when tenant keys are empty (`mergeOwnerEnvFallbackIfEmpty`). Use **Admin → Operator BYOK** to validate precedence after key rotation.
