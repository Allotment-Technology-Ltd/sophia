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

UI: `/admin/ingest/jobs` and `/admin/ingest/jobs/[id]` (retry actions when `summary.error > 0`).

## SEP URL manifest

Generate a JSON list of `plato.stanford.edu` entry URLs (one HTTP GET to the public contents page; see script header for etiquette):

```bash
pnpm sep:catalog -- --out data/sep-entry-urls.json
```

## Worker / poller

**Admin UI (no extra infra):** `/admin/ingest/jobs` list refresh and `/admin/ingest/jobs/[id]` detail polling call the server, which runs **`tickIngestionJob`** (detail) or **`tickAllRunningIngestionJobs`** (list). Keeping a tab open is enough to advance jobs; closing every tab stops ticks until something else runs the poller.

**Production (GCP, no browser):** CI deploys Cloud Run Job **`sophia-ingestion-job-poller`** on every app deploy (same image as `sophia`; one `tick` per execution). Enable automatic ticks with **`pnpm gcp:setup-ingestion-poller-scheduler`** (Cloud Scheduler every 2 minutes). See [`gcp-infrastructure.md`](./gcp-infrastructure.md).

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
