# Ingestion benchmarks (operator)

Use this checklist to compare **before/after** throughput work: telemetry in the worker, admin UI, and Firestore `ingestion_run_reports`.

**Related:** [ingestion-preset-evidence.md](./ingestion-preset-evidence.md) (how to read `GET /api/admin/ingest/analytics` for preset tuning). Longer-term **golden-set gates** are outlined in [docs/sophia/roadmap.md](../sophia/roadmap.md) under *Future enhancements (ingestion presets)*.

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

## Regression gate (prompts, models, or extraction boundaries)

When you change **prompts**, **Restormel route steps**, **pinned models**, or **passage / validation env** (`INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION`, `VALIDATION_BATCH_*`, etc.):

1. Set **`INGEST_PRESET_DISCIPLINE=warn`** (or `strict` with **`INGEST_PRESET_PROFILE`**) for SEP sources — see [ingestion-sep-preset-discipline.md](./ingestion-sep-preset-discipline.md).
2. Re-run the **golden SEP subset** from [ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md) with the **same** benchmark pins (`INGEST_PIN_*`, optional `INGEST_NO_MODEL_FALLBACK=1`).
3. Compare **`[INGEST_PRESET_FINGERPRINT]`** digests — any drift without a profile bump means runs are not apples-to-apples.
4. Compare **`[INGEST_TIMING]`**, **`json_repair` / `batch_split` counts**, and **average faithfulness** (when validation is on).
5. **Hold** a catalog or prompt promotion if golden faithfulness drops materially or `json_repair` spikes versus the stored baseline in [ingestion-per-stage-model-matrix.md](./ingestion-per-stage-model-matrix.md) / [ingestion-preset-evidence.md](./ingestion-preset-evidence.md).

## Related env knobs

| Variable | Purpose |
|----------|---------|
| `ADMIN_INGEST_MAX_CONCURRENT` | Cap parallel real ingest workers (429 when full). |
| `INGEST_PASSAGE_INSERT_CONCURRENCY` | Parallel Surreal passage writes at stage 6. |
| `VERTEX_EMBED_BATCH_DELAY_MS` | Pause between Vertex embedding batches. |
| `RELATIONS_BATCH_OVERLAP_CLAIMS` | Overlap between relation batches (worker / batch overrides). |

## Operator BYOK

Operational keys live on the first `OWNER_UIDS` Neon Auth `sub` and merge when tenant keys are empty (`mergeOwnerEnvFallbackIfEmpty`). Use **Admin → Operator BYOK** to validate precedence after key rotation.
