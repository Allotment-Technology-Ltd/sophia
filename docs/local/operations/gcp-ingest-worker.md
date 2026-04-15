# GCP: ingest workers (Cloud Run sizing, region, separation)

Sophia runs **`tsx scripts/ingest.ts`** (and fetch-source) as **child processes** on the same Cloud Run **revision** that handled the admin request (`ingestRunManager` in `src/lib/server/ingestRuns.ts`). That means **web traffic and ingest share CPU and memory** on the instance unless you split deployments.

## Right-sizing (avoid OOM “mystery” failures)

**Symptoms:** Exit code **137**, **Container terminated due to memory**, or child exits with no stack — often **Node heap** or **large JSON** (claims, embeddings batch) exceeding the **instance** limit.

| Surface | Default in repo | Notes |
|---------|-----------------|--------|
| Cloud Run **service** `sophia` | **2Gi / 1 vCPU** (see `deploy.yml`), **`NODE_OPTIONS=--max-old-space-size=1536`** | Same **memory / heap** target as `sophia-ingest-worker`; higher **HTTP concurrency** (8) for public SSR/API. Covers **SvelteKit** + **one or more** `tsx` children when `ADMIN_INGEST_RUN_REAL=1`. |
| Cloud Run **Job** `sophia-ingestion-job-poller` | **1Gi / 1 vCPU** | Runs only `scripts/ingestion-job-poller.ts --once` (lightweight). |
| **Service** `sophia-ingest-worker` | **2Gi / 1 vCPU** (see `deploy-sophia-ingest-worker-service.sh`) | Same image and **memory/heap** as `sophia`; **lower HTTP concurrency** (2) so admin ingest sessions do not share an instance with as many concurrent requests. **Deployed on every main app-deploy** (after the poller). Optional separate origin for operators; disable only via manual workflow run (`deploy_ingest_worker=false`). |

**Optional heap cap** (worker / high-memory service only): set **`NODE_OPTIONS=--max-old-space-size=1536`** (or ~75% of container memory in MiB) in Cloud Run env so Node fails with **JavaScript heap** errors instead of opaque **SIGKILL** — tune per memory limit.

**Observability:** In Cloud Console → Cloud Run → **Metrics** → **Memory utilization** / **CPU** on the **revision** that ran the ingest. Correlate with **admin** ingest start times.

**Logs (GCP + Neon, no extra vendors):** `scripts/ingest.ts` prints one JSON object per line prefixed with `[INGEST_TELEMETRY]` (for example `model_call_start`, `model_call_end`, `heartbeat`). Cloud Logging ingests stdout automatically. Optional `INGEST_TELEMETRY_HEARTBEAT_MS` (≥10s) bumps Neon `ingest_runs.last_output_at` during long model calls when `INGEST_ORCHESTRATION_RUN_ID` is set so idle watchdogs do not fire on healthy slow calls.

**Idle watchdog (Neon):** Default idle threshold is **5 minutes** (`300000` ms). Override with `INGEST_WATCHDOG_IDLE_MS` (≥60s), or set **`INGEST_WATCHDOG_IDLE_MS=0`** to disable. `tickAllRunningIngestionJobs` / the Cloud Run ingestion poller terminalize stuck `ingest_runs`, append `ingest_run_logs` / `ingest_run_issues`, and optionally requeue job items (`INGEST_WATCHDOG_REQUEUE=1`). See [ingest-watchdog-and-observability-plan.md](./ingest-watchdog-and-observability-plan.md).

**Job DLQ auto-replay:** If **`INGEST_DLQ_AUTO_REPLAY_DELAY_MS`** is set (≥60s), each poller tick may move **`retryable_exhausted`** dead-letter items back to **`pending`**. See [ingestion-credits-and-workers.md](./ingestion-credits-and-workers.md).

## Regional affinity

| Dependency | Target |
|------------|--------|
| **Cloud Run** | **`europe-west2`** (London) — set in `deploy.yml` (`REGION`) and all `gcloud` scripts. |
| **Neon** | Prefer a **European** Neon region (e.g. `aws-eu-west-2` or Frankfurt) so **Postgres RTT** from Cloud Run stays low; **pooled** `DATABASE_URL` for serverless. |
| **Vertex AI** | Production often sets **`GOOGLE_VERTEX_LOCATION=us-central1`** (Gemini / embeddings). That is a **cross-region** hop from `europe-west2`; if you see **timeouts**, tune **`INGEST_MODEL_TIMEOUT_MS`** / batch delays or **evaluate** a **European** Vertex location where your models are available. |
| **Restormel / dashboard APIs** | Align **`RESTORMEL_*`** base URLs with your **provisioned** region; keep **keys** server-side only. |

**Rule of thumb:** Co-locate **Cloud Run + Neon + Surreal** in **Europe** first (Surreal over **TLS to SurrealDB Cloud** needs no VPC; legacy private Surreal used a VPC connector). Accept **Vertex** region as a documented tradeoff until you benchmark **EU** endpoints.

## Separate worker service from web (Phase 2)

**Problem:** Traffic spikes on **`sophia`** (SSR, API) **compete** with **CPU/memory** for **ingest** children on the **same** instance.

**Options:**

1. **Scale the main service** (implemented): **`sophia`** uses **2Gi / 1 vCPU** and a **1536 MiB** Node heap cap (aligned with `sophia-ingest-worker`), **`--concurrency=8`** for public traffic, and **`max-instances`** high enough so load spreads — one URL, **same cookies** for admin.

2. **Optional second service** `sophia-ingest-worker` (script in-repo): Same **container image** and **memory/heap** as `sophia`, **lower HTTP concurrency** per instance (`--concurrency=2`) for ingest isolation, env **`ADMIN_INGEST_MAX_CONCURRENT=3`**, **same secrets** as `sophia` (VPC only if Surreal is private — see [gcp-surreal-url-verification.md](./gcp-surreal-url-verification.md)). Deploy with:
   ```bash
   IMAGE_REF=europe-west2-docker.pkg.dev/PROJECT/sophia/app:SHA \
   NEON_AUTH_BASE_URL=… RESTORMEL_GATEWAY_KEY=… … \
   bash scripts/gcp/deploy-sophia-ingest-worker-service.sh
   ```
   **Operators** who open **admin** on the **worker URL** get a **dedicated** pool for **spawn** (no web traffic on that service). You must add the worker’s **OAuth redirect URI** in Google Cloud Console if you use Google login, and **bookmark** the worker origin for **ingest** sessions.

3. **Future:** Queue-based workers (Pub/Sub / Cloud Run Jobs per URL) — out of scope for this doc; see durable jobs (`ingestion_jobs`) and poller.

## Surviving deploys (revision replacement)

Every **new Cloud Run revision** replaces the previous one: **in-memory** `ingestRunManager` state and any **local `tsx` child** are gone, while **Neon** may still show `ingest_runs.status = running` for URLs that were in flight.

**Operator recovery (implemented in app):**

- **Single run (ingest monitor):** when the monitor shows **running** but **Worker: no process** (or equivalent), use **“Respawn worker (deploy / lost process)”**. It `POST`s `/api/admin/ingest/run/:id/resume` with `{ "respawn_stale_worker": true }`, which starts `scripts/ingest.ts` again from **Neon/Surreal checkpoints** (same path as resume-from-failure).
- **Durable job:** on **Admin → Ingestion job → [job]**, use **“Respawn workers for all running URLs”** (`POST /api/admin/ingest/jobs/:id/respawn-workers`) or **Respawn** on a row in the child-run table when Neon status is **running**.

**True isolation from web deploys:** run ingestion on a **separate Cloud Run service** (`sophia-ingest-worker`, above) and **bookmark that origin** for admin ingest so deploys of the **main** `sophia` service do not kill your workers. A deploy of **that worker service** still replaces its revision — use **Respawn** after any worker-service rollout.

**Longer-term:** out-of-process executors (dedicated VM, Cloud Run **Job** per URL, or queue consumer) that poll Neon and spawn `ingest.ts` **outside** the web revision lifecycle.

## Related

- [gcp-infrastructure.md](./gcp-infrastructure.md) — load balancer, networking, jobs
- [gcp-surreal-url-verification.md](./gcp-surreal-url-verification.md) — when VPC is required
- [ingestion-credits-and-workers.md](./ingestion-credits-and-workers.md) — poller, concurrency gates
- [ingestion-gcp-quotas.md](./ingestion-gcp-quotas.md) — Vertex / API quotas
