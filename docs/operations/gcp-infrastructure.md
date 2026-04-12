# GCP infrastructure (Sophia production)

Sophia’s production footprint lives in **Google Cloud**. The repo **does not** ship Pulumi, Terraform, or another paid IaC runtime. **Source of truth for app rollout** is [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml): Docker build, push to Artifact Registry, and `gcloud run deploy` with Secret Manager bindings.

For **declarative GCP** in future, prefer **OpenTofu** (open source, no vendor lock-in) or **Terraform** in a dedicated repo or directory—this document stays accurate for what exists today.

## Project and region

| Item | Value |
|------|--------|
| GCP project | `sophia-488807` (see GitHub secret `GCP_PROJECT_ID`) |
| Primary region | `europe-west2` (London) |
| SurrealDB VM zone | `europe-west2-b` (typical) |

## Network and data plane

- **VPC Serverless connector** `sophia-connector` (`europe-west2`, `default` VPC, e.g. CIDR `10.8.0.0/28`): Cloud Run uses this for **private egress** to SurrealDB.
- **SurrealDB** runs on a **GCE VM** with private IP **10.154.0.2** (stable in VPC). The app’s `SURREAL_URL` is mounted from Secret Manager at deploy time.
- **Firewall** `allow-surrealdb`: TCP 8000 from the **VPC connector CIDR** to instances tagged `sophia-db` (not open to `0.0.0.0/0`).

## Container registry

- **Artifact Registry** repository `sophia`, format `DOCKER`, location `europe-west2`.
- App image: `europe-west2-docker.pkg.dev/sophia-488807/sophia/app:<git-sha>` (and `:latest`).

## Cloud Run

- **Service** `sophia` (`gcloud run services describe sophia --region europe-west2`): SvelteKit app, VPC connector `sophia-connector`, `private-ranges-only` egress to reach SurrealDB. **Sizing** (CPU/memory/concurrency) is set in [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — currently **2Gi / 2 vCPU**, **`--concurrency=8`**, **`NODE_OPTIONS=--max-old-space-size=1536`** so co-located `tsx` ingest children are less likely to OOM the instance.
- **Service** `sophia-ingest-worker`: same image, **4Gi / 2 vCPU**, **`--concurrency=2`** — deployed automatically after the poller on each main **app-deploy**; manual override via [`scripts/gcp/deploy-sophia-ingest-worker-service.sh`](../../scripts/gcp/deploy-sophia-ingest-worker-service.sh). See [gcp-ingest-worker.md](./gcp-ingest-worker.md) for regional affinity (Neon, Vertex), OAuth on a second `*.run.app` URL, and when to use the worker vs the main service.

### Neon Postgres migrations (CI/CD)

On each **main** deploy that builds the app image, [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) runs **`pnpm db:migrate:ci`** after authenticating with Workload Identity. It reads **`neon-database-url`** from Secret Manager and applies every `drizzle/*.sql` not yet recorded in `schema_migrations`, **before** `gcloud run deploy`. The GitHub deploy service account (e.g. `github-deploy@…`) must have **`secretmanager.secretAccessor`** on `neon-database-url` (in addition to permissions needed for Artifact Registry and Cloud Run). Grant once with [`scripts/gcp/ensure-wif-neon-secret-access.sh`](../../scripts/gcp/ensure-wif-neon-secret-access.sh) or `pnpm gcp:ensure-wif-neon-access`.

**Neon ingest persistence** in app code (`isNeonIngestPersistenceEnabled`) is **on** whenever **`DATABASE_URL`** is set at runtime. Production sets it via `--set-secrets=DATABASE_URL=neon-database-url:latest` and **`SOPHIA_DATA_BACKEND=neon`** for `sophia_documents`. Removing `DATABASE_URL` would disable durable ingestion jobs and related Neon-backed ingest tables.

### Durable ingestion job poller (Cloud Run Job)

- **Job** `sophia-ingestion-job-poller`: same container image as service `sophia` (`…/sophia/app:<sha>`). Each execution runs `pnpm exec tsx scripts/ingestion-job-poller.ts --once` to advance Neon-backed `ingestion_jobs` without keeping the admin UI open. Deployed automatically after the web service in **deploy.yml** via [`scripts/gcp/deploy-sophia-ingestion-poller-job.sh`](../../scripts/gcp/deploy-sophia-ingestion-poller-job.sh). Runtime service account defaults to **`sophia-app@…`** (same Secret Manager bindings as the web service).

- **Scheduler (one-time setup):** Cloud Scheduler job `sophia-ingestion-poller-tick` can POST to the Run Jobs API every 2 minutes using a small invoker SA (`sophia-poller-scheduler@…`). Create/update with [`scripts/gcp/setup-ingestion-poller-scheduler.sh`](../../scripts/gcp/setup-ingestion-poller-scheduler.sh) (`pnpm gcp:setup-ingestion-poller-scheduler`). Requires `cloudscheduler.googleapis.com` enabled ([`scripts/gcp/enable-required-apis.sh`](../../scripts/gcp/enable-required-apis.sh)).

### Other Cloud Run jobs (batch / nightly)

- **`sophia-ingest`** — wave/batch ingestion image `…/sophia/sophia-ingest:<tag>` (see `Dockerfile.ingest` / wave scripts).
- **`sophia-nightly-link-ingest`** — nightly link ingestion (`pnpm exec tsx scripts/ingest-nightly-links.ts`).
- **Scheduler** (e.g. `sophia-nightly-link-ingest-0200` in `europe-west2`): HTTP POST to Cloud Run Jobs API (OAuth service account).

Exact CPU/memory/env for the `sophia` service and `sophia-ingest-worker` are set in **deploy.yml** / the worker script; console-only drift may still exist until aligned manually.

### First-time / recovery checklist (operator)

1. `pnpm gcp:enable-apis` (or `bash scripts/gcp/enable-required-apis.sh`) — APIs including Run, Scheduler, Secret Manager.
2. `pnpm gcp:ensure-wif-neon-access` — WIF deploy SA can read `neon-database-url` for CI migrations.
3. Merge to `main` (or workflow dispatch with **force app deploy**) — builds image, migrates Neon, deploys `sophia`, updates **`sophia-ingestion-job-poller`**.
4. `pnpm gcp:setup-ingestion-poller-scheduler` — optional but recommended so poller runs every 2 minutes without manual `gcloud run jobs execute`.
5. Manual tick: `gcloud run jobs execute sophia-ingestion-job-poller --region=europe-west2 --project=sophia-488807`.

## Load balancing and DNS

- **Global external HTTP(S) load balancer** (EXTERNAL_MANAGED) in front of Cloud Run: serverless NEG → backend service → URL map → HTTPS proxy → forwarding rule on a **reserved global IP**.
- **Managed certificate** for `usesophia.app` and `www.usesophia.app`.
- **HTTP → HTTPS redirect** on the same static IP (separate URL map / HTTP proxy / forwarding rule on port 80).

## Service accounts (typical)

- `sophia-app@…` — Cloud Run **app** runtime and **`sophia-ingestion-job-poller`** job runtime (default): Secret Manager accessor, Vertex user, logging, etc.
- `github-deploy@…` — GitHub Actions via Workload Identity: deploy Cloud Run service + jobs, read `neon-database-url` for migrations (grant with `ensure-wif-neon-secret-access.sh`).
- `sophia-poller-scheduler@…` — optional; Cloud Scheduler uses this identity to invoke `sophia-ingestion-job-poller` (`setup-ingestion-poller-scheduler.sh`).
- `sophia-ingest@…` — Cloud Run **jobs** runtime (legacy wave ingest image).
- `sophia-nightly-scheduler@…` — least-privilege identity used by Cloud Scheduler to invoke the nightly link job.

IAM is managed in **GCP Console** or **`gcloud`**; keep changes auditable (PRs to scripts/docs or a future OpenTofu tree).

## Secrets

Secret Manager secret **names** and Cloud Run bindings are listed in **deploy.yml** (`--set-secrets=…`) and in [`gcp-secret-manager-inventory.md`](./gcp-secret-manager-inventory.md). Sync from local env with `pnpm secrets:sync-gcp`.

## Operational commands

```bash
# Deployed app URL
gcloud run services describe sophia --region=europe-west2 --project=sophia-488807 --format='value(status.url)'

# Run wave ingest job once
gcloud run jobs execute sophia-ingest --region=europe-west2 --project=sophia-488807

# Durable ingestion job poller (Neon ticks)
gcloud run jobs execute sophia-ingestion-job-poller --region=europe-west2 --project=sophia-488807

# Nightly scheduler
gcloud scheduler jobs describe sophia-nightly-link-ingest-0200 --location=europe-west2 --project=sophia-488807
```

## Related docs

- [GCP ingest worker — sizing, region, separation](./gcp-ingest-worker.md)
- [Runbooks — monitoring & ingestion](../reference/operations/runbooks.md)
- [Nightly link ingestion runbook](../reference/operations/runbooks/nightly-link-ingestion-runbook.md)
- [Neon migration walkthrough](./neon-migration-walkthrough.md)
