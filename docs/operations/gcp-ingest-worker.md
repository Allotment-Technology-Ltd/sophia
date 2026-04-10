# GCP: ingest workers (Cloud Run sizing, region, separation)

Sophia runs `**tsx scripts/ingest.ts**` (and fetch-source) as **child processes** on the same Cloud Run **revision** that handled the admin request (`ingestRunManager` in `src/lib/server/ingestRuns.ts`). That means **web traffic and ingest share CPU and memory** on the instance unless you split deployments.

## Right-sizing (avoid OOM “mystery” failures)

**Symptoms:** Exit code **137**, **Container terminated due to memory**, or child exits with no stack — often **Node heap** or **large JSON** (claims, embeddings batch) exceeding the **instance** limit.


| Surface                                         | Default in repo                                                 | Notes                                                                                                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run **service** `sophia`                  | **2Gi / 2 vCPU** (see `deploy.yml`)                             | Must cover **SvelteKit** + **one or more** `tsx` children when `ADMIN_INGEST_RUN_REAL=1`.                                                                                                                               |
| Cloud Run **Job** `sophia-ingestion-job-poller` | **1Gi / 1 vCPU**                                                | Runs only `scripts/ingestion-job-poller.ts --once` (lightweight).                                                                                                                                                       |
| **Service** `sophia-ingest-worker`              | **4Gi / 2 vCPU** (see `deploy-sophia-ingest-worker-service.sh`) | Same image as `sophia`; **deployed on every main app-deploy** (after the poller). Use its URL for admin ingest to isolate from public web traffic. Disable only via manual workflow run (`deploy_ingest_worker=false`). |


**Optional heap cap** (worker / high-memory service only): set `**NODE_OPTIONS=--max-old-space-size=3072`** (or ~75% of container memory in MiB) in Cloud Run env so Node fails with **JavaScript heap** errors instead of opaque **SIGKILL** — tune per memory limit.

**Observability:** In Cloud Console → Cloud Run → **Metrics** → **Memory utilization** / **CPU** on the **revision** that ran the ingest. Correlate with **admin** ingest start times.

## Regional affinity


| Dependency                     | Target                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud Run**                  | `**europe-west2`** (London) — set in `deploy.yml` (`REGION`) and all `gcloud` scripts.                                                                                                                                                                                                               |
| **Neon**                       | Prefer a **European** Neon region (e.g. `aws-eu-west-2` or Frankfurt) so **Postgres RTT** from Cloud Run stays low; **pooled** `DATABASE_URL` for serverless.                                                                                                                                        |
| **Vertex AI**                  | Production often sets `**GOOGLE_VERTEX_LOCATION=us-central1`** (Gemini / embeddings). That is a **cross-region** hop from `europe-west2`; if you see **timeouts**, tune `**INGEST_MODEL_TIMEOUT_MS`** / batch delays or **evaluate** a **European** Vertex location where your models are available. |
| **Restormel / dashboard APIs** | Align `**RESTORMEL_*`** base URLs with your **provisioned** region; keep **keys** server-side only.                                                                                                                                                                                                  |


**Rule of thumb:** Co-locate **Cloud Run + Neon + Surreal (VPC)** in **Europe** first; accept **Vertex** region as a documented tradeoff until you benchmark **EU** endpoints.

## Separate worker service from web (Phase 2)

**Problem:** Traffic spikes on `**sophia`** (SSR, API) **compete** with **CPU/memory** for **ingest** children on the **same** instance.

**Options:**

1. **Scale the main service** (implemented): **2Gi / 2 vCPU** and `**max-instances`** high enough so **ingest** and **web** rarely share one instance under load — simplest, one URL, **same cookies** for admin.
2. **Optional second service** `sophia-ingest-worker` (script in-repo): Same **container image** as `sophia`, **higher** memory (**4Gi**), **lower concurrency** per instance (`--concurrency=2`), **same VPC + secrets**. Deploy with:
  ```bash
   IMAGE_REF=europe-west2-docker.pkg.dev/PROJECT/sophia/app:SHA \
   NEON_AUTH_BASE_URL=… RESTORMEL_GATEWAY_KEY=… … \
   bash scripts/gcp/deploy-sophia-ingest-worker-service.sh
  ```
   **Operators** who open **admin** on the **worker URL** get a **dedicated** pool for **spawn** (no web traffic on that service). You must add the worker’s **OAuth redirect URI** in Google Cloud Console if you use Google login, and **bookmark** the worker origin for **ingest** sessions.
3. **Future:** Queue-based workers (Pub/Sub / Cloud Run Jobs per URL) — out of scope for this doc; see durable jobs (`ingestion_jobs`) and poller.

## Related

- [gcp-infrastructure.md](./gcp-infrastructure.md) — load balancer, VPC, jobs
- [ingestion-credits-and-workers.md](./ingestion-credits-and-workers.md) — poller, concurrency gates
- [ingestion-gcp-quotas.md](./ingestion-gcp-quotas.md) — Vertex / API quotas

