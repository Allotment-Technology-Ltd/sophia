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

- **Service** `sophia` (`gcloud run services describe sophia --region europe-west2`): SvelteKit app, VPC connector `sophia-connector`, `private-ranges-only` egress to reach SurrealDB.
- **Jobs**
  - `sophia-ingest` — ingestion workload image `…/sophia/sophia-ingest:<tag>`.
  - `sophia-nightly-link-ingest` — nightly link ingestion (same image family; runs `pnpm exec tsx scripts/ingest-nightly-links.ts`).
- **Scheduler** (e.g. `sophia-nightly-link-ingest-0200` in `europe-west2`): HTTP POST to Cloud Run Jobs API to execute the nightly job (service account–based OAuth).

Exact CPU/memory/env for the service are set in **deploy.yml** (`gcloud run deploy …`); additional env from Pulumi-era stacks may still exist in console until aligned manually.

## Load balancing and DNS

- **Global external HTTP(S) load balancer** (EXTERNAL_MANAGED) in front of Cloud Run: serverless NEG → backend service → URL map → HTTPS proxy → forwarding rule on a **reserved global IP**.
- **Managed certificate** for `usesophia.app` and `www.usesophia.app`.
- **HTTP → HTTPS redirect** on the same static IP (separate URL map / HTTP proxy / forwarding rule on port 80).

## Service accounts (typical)

- `sophia-app@…` — Cloud Run **app** runtime: Secret Manager accessor, Vertex user, logging, etc.
- `sophia-ingest@…` — Cloud Run **jobs** runtime.
- `sophia-nightly-scheduler@…` — least-privilege identity used by Cloud Scheduler to invoke the nightly job.

IAM is managed in **GCP Console** or **`gcloud`**; keep changes auditable (PRs to scripts/docs or a future OpenTofu tree).

## Secrets

Secret Manager secret **names** and Cloud Run bindings are listed in **deploy.yml** (`--set-secrets=…`) and in [`gcp-secret-manager-inventory.md`](./gcp-secret-manager-inventory.md). Sync from local env with `pnpm secrets:sync-gcp`.

## Operational commands

```bash
# Deployed app URL
gcloud run services describe sophia --region=europe-west2 --project=sophia-488807 --format='value(status.url)'

# Run ingest job once
gcloud run jobs execute sophia-ingest --region=europe-west2 --project=sophia-488807

# Nightly scheduler
gcloud scheduler jobs describe sophia-nightly-link-ingest-0200 --location=europe-west2 --project=sophia-488807
```

## Related docs

- [Runbooks — monitoring & ingestion](../reference/operations/runbooks.md)
- [Nightly link ingestion runbook](../reference/operations/runbooks/nightly-link-ingestion-runbook.md)
- [Neon migration walkthrough](./neon-migration-walkthrough.md)
