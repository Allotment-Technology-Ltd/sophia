---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting operational index only.

# Runbooks & shortcuts — sophia

## Quick commands
- Install dependencies: `pnpm install`
- Start dev server: `pnpm run dev`
- Start dev server wired to production SurrealDB (auto tunnel + secret): `pnpm run dev:prod-db`
- Run checks: `pnpm run check` (runs svelte-check + custom scripts if configured)

## Infra (GCP) — no Pulumi in-repo

**CI/CD:** Production app deploys run from **`.github/workflows/deploy.yml`** (Docker → Artifact Registry → `gcloud run deploy`). Secret mounts and env vars are defined there.

**Layout & resources** (VPC connector, Cloud Run service/jobs, load balancer, typical service accounts): see **[GCP infrastructure](../../operations/gcp-infrastructure.md)**.

**GCP CLI auth (operators):**

```bash
gcloud auth login
gcloud auth application-default login   # if tools need ADC
```

**Future declarative IaC:** Prefer **OpenTofu** or **Terraform** (free tooling) in a separate path or repo if you want versioned GCP state again; keep this repo focused on the app and the deploy workflow.

## Monitoring & ingestion
- Run a single monitor job once:
  - `pnpm run monitor:wave -- --once` (or equivalent script configured)
- Resume ingestion for a wave:
  - `pnpm run ingest:wave1:retry`
- Run nightly deferred link ingestion worker locally:
  - `pnpm run ingest:nightly`
- Cloud Run nightly deferred link ingestion operations:
  - `gcloud run jobs execute sophia-nightly-link-ingest --region europe-west2`
  - `gcloud scheduler jobs describe sophia-nightly-link-ingest-0200 --location=europe-west2`
  - See `docs/reference/operations/runbooks/nightly-link-ingestion-runbook.md`

## Health checks
- Health endpoint (if deployed): `curl -s --max-time 30 https://usesophia.app/api/health | jq .`
- Periodic checks should validate health endpoint and ingestion queues.

---

## SurrealDB — Surrealist GUI access (production)

SurrealDB runs on a private GCE VM (`sophia-db`, `europe-west2-b`). Port 8000 is firewalled to the VPC connector only, so you need an **SSH IAP tunnel** to reach it from your Mac.

### Step 1 — Authenticate gcloud (first time / after token expiry)

```bash
gcloud auth login
```

### Step 2 — Open the SSH tunnel (keep this terminal tab running)

```bash
gcloud compute ssh sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --tunnel-through-iap \
  -- -L 8800:localhost:8000 -N
```

This forwards `localhost:8800` → SurrealDB port 8000 on the VM via IAP. No firewall changes needed.

### Step 3 — Connect in Surrealist

Download Surrealist from surrealist.app (native arm64 Mac build available).

Create/open the **Sophia Production** connection with these settings:

| Field     | Value                                    |
| --------- | ---------------------------------------- |
| Protocol  | WS                                       |
| Address   | `localhost:8800`                         |
| Auth mode | **Root** (not Namespace or Database)     |
| Username  | `root`                                   |
| Password  | retrieve from Secret Manager (see below) |

After connecting, navigate breadcrumbs: `sophia` namespace → `sophia` database.

### Retrieve the DB password

```bash
gcloud secrets versions access latest \
  --secret="surreal-db-pass" \
  --project=sophia-488807
```

### Setting up a dedicated Surrealist user (do this once)

To avoid using root credentials in future, create a namespace-level admin user from the Surrealist Query tab:

```sql
-- Create a named admin user scoped to the sophia namespace
DEFINE USER surrealist ON NAMESPACE
  PASSWORD 'choose-a-strong-password'
  ROLES EDITOR;
```

Then update the Surrealist connection:

- Auth mode → **Namespace**
- Username: `surrealist`
- Password: the one you chose above
- Namespace: `sophia`, Database: `sophia`

This is safer than using the root account and avoids needing to fetch the secret each time.

---

### Useful queries

#### Schema overview

```sql
INFO FOR DB;
```

#### Record counts across all tables

```sql
SELECT 'source' AS table, count() AS n FROM source GROUP ALL;
SELECT 'claim' AS table, count() AS n FROM claim GROUP ALL;
SELECT 'argument' AS table, count() AS n FROM argument GROUP ALL;
SELECT 'query_cache' AS table, count() AS n FROM query_cache GROUP ALL;
SELECT 'supports' AS table, count() AS n FROM supports GROUP ALL;
SELECT 'contradicts' AS table, count() AS n FROM contradicts GROUP ALL;
SELECT 'depends_on' AS table, count() AS n FROM depends_on GROUP ALL;
```

#### Browse sources

```sql
SELECT id, title, author, year, source_type, status, claim_count FROM source ORDER BY ingested_at DESC LIMIT 20;
```

#### Browse claims for a source

```sql
-- Replace source:xyz with a real record ID from the source table
SELECT id, text, claim_type, domain, confidence FROM claim WHERE source = source:xyz;
```

#### Find claims by domain

```sql
SELECT id, text, claim_type, confidence FROM claim WHERE domain = 'ethics' LIMIT 20;
```

#### Inspect relations between claims

```sql
SELECT in, out, strength, note FROM supports LIMIT 20;
SELECT in, out, strength, note FROM contradicts LIMIT 20;
```

#### Check query cache

```sql
SELECT query_text, hit_count, created_at, expires_at FROM query_cache ORDER BY hit_count DESC LIMIT 20;
```

#### Expired cache entries

```sql
SELECT id, query_text, expires_at FROM query_cache WHERE expires_at < time::now();
```

#### Delete expired cache entries

```sql
DELETE query_cache WHERE expires_at < time::now();
```

#### Full-text search across claims

```sql
SELECT id, text, domain, confidence FROM claim WHERE text ~ 'free will' LIMIT 20;
```

#### Claim graph — what a claim supports/contradicts

```sql
-- Replace claim:xyz with a real record ID
SELECT ->supports->claim AS supported, ->contradicts->claim AS contradicted FROM claim:xyz FETCH supported, contradicted;
```
