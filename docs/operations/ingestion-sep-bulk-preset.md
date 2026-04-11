# SEP bulk ingestion preset (operator)

Use for **Stanford Encyclopedia of Philosophy** (or similar) **large URL lists** via durable jobs (`/admin/ingest/jobs`).

## Goals

- **Throughput:** complete many entries without operator babysitting (auto-retry, poller, optional jitter).
- **Cost:** prefer **validation off** or a **cheap validation** tier on first pass if quality review is deferred.
- **Politeness:** respect site etiquette; keep HTTP fetch concurrency modest; use `pnpm sep:catalog` for URL lists.

## Suggested environment (first pass)

Tune per project evidence; starting points:

| Concern | Suggestion |
|---------|------------|
| Validation | Start job with **Validate LLM** **off** in the UI for speed; or set `INGEST_VALIDATION_MODE=off` for CLI workers. For a fast first pass with spot-checks, use `INGEST_VALIDATION_MODE=sampled` plus `INGEST_VALIDATION_SAMPLE_RATE` (e.g. `0.15`) and a second job later with full validation. |
| Concurrent workers | `ADMIN_INGEST_MAX_CONCURRENT=2` (default) or raise only after quotas allow. |
| Multi-instance | `INGEST_GLOBAL_CONCURRENCY_GATE=1` when several Cloud Run instances spawn workers. |
| Embedding throughput | Raise `VERTEX_EMBED_BATCH_SIZE` within provider limits (Vertex: up to 250); tune `VERTEX_EMBED_BATCH_DELAY_MS` / aliases `INGEST_EMBED_*` so you stay under quota without unnecessary stalls. Admin **batch overrides** can set `embedBatchSize` and `embedBatchDelayMs` per run. |
| Fetch stability | Optional `FETCH_SOURCE_CACHE=1` for `scripts/fetch-source.ts` (canonical URL hash → disk cache, TTL via `FETCH_SOURCE_CACHE_TTL_HOURS`) to avoid redundant HTTP on retry/re-ingest; still respect SEP etiquette and overall rate limits. |
| Neon connections | Optional `NEON_POOL_MAX` on busy hosts to cap the Drizzle serverless pool. |
| Surreal Stage 6 | Optional `INGEST_CLAIM_INSERT_CONCURRENCY` (default 8) to batch parallel claim `CREATE`s; lower if Surreal saturates. |
| Embedding contention | Optional `INGEST_PHASE_EMBED_MAX_CONCURRENT` (e.g. 2–4) if many pipelines hit Stage 4 together. |
| Launch spacing | Optional `INGEST_JOB_LAUNCH_JITTER_MS` (e.g. `500`–`2000`) to spread child spawns. |
| Retries | `INGEST_JOB_ITEM_MAX_ATTEMPTS=2` (default): one automatic re-queue per URL on failure. |

## Restormel / model pins

Align stage pins with [ingestion-per-stage-model-matrix.md](./ingestion-per-stage-model-matrix.md). For bulk, prefer **matrix defaults** unless benchmarks show a need for heavier models on every entry.

## Preset discipline (SEP quality)

For **comparable** waves and visible regressions, use [ingestion-sep-preset-discipline.md](./ingestion-sep-preset-discipline.md): log or enforce **`INGEST_PRESET_FINGERPRINT`**, name runs with **`INGEST_PRESET_PROFILE`**, and optionally route low faithfulness claims to **`needs_review`** after store (`INGEST_POST_STORE_LOW_VALIDATION_*`).

## Related

- [ingestion-credits-and-workers.md](./ingestion-credits-and-workers.md) — poller, Scheduler, auto-retry.
- [ingestion-gcp-quotas.md](./ingestion-gcp-quotas.md) — quotas and alerts.
