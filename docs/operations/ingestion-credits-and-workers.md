# Ingestion credits and workers (GCP-first)

## Credits (summary)

- **GCP** (`sophia-488807` or your billing project): primary for **Vertex** (Gemini + `text-embedding-005`) and **compute** for workers. Burn soonest-expiring credit tranches first; set Billing budgets/alerts.
- **AWS Activate / Azure free tiers**: optional burst or experiments; not required for the reference pipeline.

## Admin Expand (single URL)

Single-URL runs from `/admin/ingest` default to **full pipeline including Surreal store**. Pass `stop_before_store: true` on `POST /api/admin/ingest/run` only when you want preview mode (same run skips store; use sync later).

## Durable jobs (Neon)

Multi-URL jobs live in Postgres (`ingestion_jobs`, `ingestion_job_items`, `ingestion_job_events`). Production applies all `drizzle/*.sql` automatically **before each Cloud Run deploy** (`pnpm db:migrate:ci` in [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)). Local/staging: `pnpm db:migrate` with `DATABASE_URL` set.

Admin API:

- `POST /api/admin/ingest/jobs` — body `{ "urls": [...], "concurrency"?: number, "notes"?: string, "validate"?: boolean }`
- `GET /api/admin/ingest/jobs` — recent jobs
- `GET /api/admin/ingest/jobs/[id]` — detail (ticks job server-side)
- `GET /api/admin/ingest/jobs/[id]/events?since_seq=` — timeline
- `POST /api/admin/ingest/jobs/[id]/retry` — body `{ "mode": "restart" | "resume", "itemId"?: string }`. **restart** re-queues failed items as new child runs; **resume** calls `resumeFromFailure` on existing `childRunId` (pipeline checkpoint). Omit `itemId` to affect all failed rows.
- `GET /api/admin/ingest/jobs/dlq?limit=` — cross-job dead-letter rows (`ingestion_job_items` with `dlq_enqueued_at` set after max attempts).
- `POST /api/admin/ingest/jobs/dlq` — body `{ "itemIds": string[] }` moves selected **`error`** rows back to **`pending`** and ticks affected jobs (`item_replay_from_dlq` event).

UI: `/admin/ingest/jobs` (includes **Dead letter** table) and `/admin/ingest/jobs/[id]` (retry actions when `summary.error > 0`).

**Automatic retry:** failed items are moved back to **`pending`** until **`INGEST_JOB_ITEM_MAX_ATTEMPTS`** (default **2** total starts per URL) is reached — **only when the error is classified as retryable** (429, timeouts, overload, `ingest_stuck_timeout`, TPM-style strings, etc.). **Permanent** failures (e.g. 404) stay in **`error`**. Unclassified errors stay in **`error`** unless **`INGEST_JOB_REQUEUE_UNKNOWN=1`**. Events: `item_requeued_auto`, `item_launch_throttled` (concurrency cap → exponential backoff via **`blocked_until`**), `item_stuck` (optional wall-clock / stale log detection).

**Dead letter (DLQ):** when an item stays **`error`** and **`attempts >= INGEST_JOB_ITEM_MAX_ATTEMPTS`**, the next reconcile stamps **`dlq_enqueued_at`**, **`last_failure_kind`**, **`failure_class`** (`retryable_exhausted` | `permanent` | `unknown_exhausted`) and emits **`item_dlq`**. Operators replay from the admin **Dead letter** section or API. Optional autonomy: **`INGEST_DLQ_AUTO_REPLAY_DELAY_MS`** (≥60s, e.g. `3600000` for 1h) moves **`retryable_exhausted`** rows back to **`pending`** after that cooldown on each `tickAllRunningIngestionJobs` / poller pass (`item_replay_from_dlq_auto`).

**Launch throttle:** `createRun` failures that match “too many concurrent ingest workers” re-queue the item as **`pending`** with **`blocked_until`** (no extra **`attempts`** charge) so the poller does not hot-loop.

**Stuck runner (optional):** set **`INGEST_JOB_ITEM_MAX_WALL_MS`** (absolute time since child run `createdAt`) and/or **`INGEST_JOB_ITEM_STALE_MS`** (no log activity vs `lastOutputAt` / `createdAt`). Non-terminal runs past the threshold are marked **`error`** with `ingest_stuck_timeout` (retryable auto-requeue when attempts allow).

**Preflight (optional):** **`INGEST_JOB_PREFLIGHT=1`** before creating a job calls Restormel **`/providers/health`** (requires **`RESTORMEL_DASHBOARD_API_BASE`** + **`RESTORMEL_DASHBOARD_API_KEY`**).

**Store idempotency:** `scripts/ingest.ts` can persist **`ingest_source_text_sha256`** on Surreal `source` (default on) and **`INGEST_STORE_ENFORCE_TEXT_HASH=1`** aborts if an existing row’s hash disagrees with the current `data/sources` body (same canonical URL).

**Neon egress (admin child runs):** verbose `scripts/ingest.ts` stdout used to append **every** line to **`ingest_run_logs`** and bump activity, which can dominate small-plan transfer. Set **`INGEST_NEON_LOG_PERSISTENCE=minimal`** to keep orchestrator lines plus high-signal child lines (timing/telemetry/finetune/cancel/failure-shaped patterns), or **`off`** to skip log rows entirely (run **`snapshot_json`** still updates; scripts that read **`ingest_run_logs`** lose detail). **`INGEST_NEON_ACTIVITY_DEBOUNCE_MS`** (default **1500**) coalesces **`lastOutputAt`** updates; terminal paths flush immediately.

## SEP URL manifest

Generate a JSON list of `plato.stanford.edu` entry URLs (one HTTP GET to the public contents page; see script header for etiquette):

```bash
pnpm sep:catalog -- --out data/sep-entry-urls.json
```

## Worker / poller

**Admin UI (no extra infra):** `/admin/ingest/jobs` list refresh and `/admin/ingest/jobs/[id]` detail polling call the server, which runs **`tickIngestionJob`** (detail) or **`tickAllRunningIngestionJobs`** (list). Keeping a tab open is enough to advance jobs; closing every tab stops ticks until something else runs the poller.

### Production operator checklist

1. **`pnpm db:migrate`** (or CI `db:migrate:ci`) has applied latest `drizzle/*.sql` — including optional **`ingest_concurrency_gate`** / **`ingest_phase_gate`** if you use global or phase limits, and **`0011_ingestion_job_item_dlq.sql`** for DLQ columns.
2. **Poller** runs without an open browser: Cloud Scheduler → Cloud Run Job `sophia-ingestion-job-poller` (or `pnpm ingestion:job-poller` in CI). Logs should show `[poller] Ticked N job(s)` when work exists. In GCP Console, confirm the schedule target matches this job and the execution role can invoke it. For large batches (50+ URLs), consider a **1 minute** schedule if Neon and worker capacity allow (default docs often use 2 minutes).
3. **Quotas and alerts:** Vertex TPM, embedding APIs, and Neon — tune using your cloud console and provider dashboards (extended quota notes live in the private ops doc pack, not shipped here).
4. **Optional multi-instance:** set **`INGEST_GLOBAL_CONCURRENCY_GATE=1`** so concurrent child processes are counted in Neon across app replicas (same cap as `ADMIN_INGEST_MAX_CONCURRENT`).
5. **Long unattended batches:** consider **`INGEST_JOB_REQUEUE_UNKNOWN=1`** after validating false-positive rate; tune **`INGEST_WATCHDOG_IDLE_MS`** / **`INGEST_JOB_ITEM_STALE_MS`**; use DLQ UI or **`INGEST_DLQ_AUTO_REPLAY_DELAY_MS`** for retryable exhausted items.

**Production (GCP, no browser):** CI deploys Cloud Run Job **`sophia-ingestion-job-poller`** on every app deploy (same image as `sophia`; one `tick` per execution). Enable automatic ticks with **`pnpm gcp:setup-ingestion-poller-scheduler`** (Cloud Scheduler every 2 minutes). Full GCP topology is maintained in the private operations pack.

**Throughput (batching):** embeddings already batch via `embedTexts` / `INGEST_EMBED_BATCH_SIZE`; LLM stages use token-target batch envs in `scripts/ingest.ts`. Vendor **async** batch APIs are a separate lane (see `scripts/ingest.ts` and optional internal async-lane notes).

**Local / ad hoc:**

```bash
pnpm ingestion:job-poller
```

Optional standalone image (not required if you use the app image in GCP):

```bash
docker build -f Dockerfile.ingest-worker -t sophia-ingest-worker .
docker run --env-file .env sophia-ingest-worker
```

## GPU

Self-hosted GPU (vLLM, TEI, etc.) is **evidence-gated** only after managed API cost/latency data justify it.
