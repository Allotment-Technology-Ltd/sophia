---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-04-19
---

# Railway production deployment (usesophia.app)

SOPHIA production is deployed on **Railway** (not Google Cloud).

## 1) Railway service setup

1. Create/choose Railway project + service for this repository.
2. Ensure the service uses the repo root and `railway.toml` + `Dockerfile`.
3. Set the service to deploy from `main`.

The app runtime is Node adapter output (`node build`) and must run with:

- `PORT` provided by Railway (already handled by runtime)
- `HOST=0.0.0.0` (set in Dockerfile)

## 2) Required Railway environment variables

Set these in Railway service variables (Production environment):

- `DATABASE_URL`
- `USE_NEON_AUTH=1`
- `NEON_AUTH_BASE_URL` (or **`NEON_AUTH_URL`** as an alias — the app now accepts either name)
- `PUBLIC_NEON_AUTH_URL` (same value as the auth `base_url` above; required for the browser to match the server)
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY`
- `VOYAGE_API_KEY`
- `SURREAL_URL`
- `SURREAL_USER`
- `SURREAL_PASS`
- `SURREAL_NAMESPACE`
- `SURREAL_DATABASE`
- `RESTORMEL_GATEWAY_KEY`
- `RESTORMEL_PROJECT_ID`
- `RESTORMEL_ENVIRONMENT_ID` (the **UUID** for the target environment in Restormel Keys — e.g. from the environment details screen — **not** the display name `production` / `staging`)
- `RESTORMEL_KEYS_BASE`
- `RESTORMEL_EVALUATE_URL`
- `ADMIN_UIDS`
- `OWNER_UIDS`

**Neon Auth must match the browser and the server.** The client uses `PUBLIC_NEON_AUTH_URL` (same as `NEON_AUTH_BASE_URL`). If those drift from the Neon Auth `base_url` in the [Neon API or Console](https://neon.com/docs/auth), JWT verification fails and API calls return 401 (invalid or expired session). The app’s **owner role** is stored in Postgres `sophia_documents` (collection `users` keyed by JWT `sub`), not in a separate SQL `user` table—set owner via **Admin → User management** or by updating that document for your Neon `sub`.

**Check deployment:** `GET /api/health/auth-config` (no `Authorization` header) returns `use_neon_auth`, JWKS host, and how many issuers/audiences the process trusts. Optional: `NEON_AUTH_TRUSTED_ISSUERS`, `NEON_AUTH_TRUSTED_AUDIENCES`, `NEON_AUTH_JWT_CLOCK_TOLERANCE` in `.env.example`.

Keep secrets in Railway/GitHub secrets only; do not commit them.

### Existing GCP secret name → Railway variable mapping

If you are cutting over from previous Cloud Run Secret Manager bindings, migrate as:

| Previous GCP secret id | Railway variable |
| --- | --- |
| `neon-database-url` | `DATABASE_URL` |
| `surreal-db-url` | `SURREAL_URL` |
| `surreal-db-user` | `SURREAL_USER` |
| `surreal-db-pass` | `SURREAL_PASS` |
| `surreal-db-namespace` | `SURREAL_NAMESPACE` |
| `surreal-db-database` | `SURREAL_DATABASE` |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` |
| `google-ai-api-key` | `GOOGLE_AI_API_KEY` |
| `voyage-api-key` | `VOYAGE_API_KEY` |
| `admin-uids` | `ADMIN_UIDS` |
| `owner-uids` | `OWNER_UIDS` |

## 3) GitHub Actions deployment flow

`.github/workflows/deploy.yml` runs on every **`main`** push (and on PRs). After **security** passes, the **`deploy-production`** job (single job, not split across two `needs` so Railway is never stuck behind a missing sibling) runs in order: **Neon migrate** (skips with a warning if `DATABASE_URL_PRODUCTION` is unset) then **`railway up`**. Migrations and deploy are **one linear job** so a skipped or misconfigured `needs` edge case cannot block `railway` alone.

- security + quality checks
- `pnpm db:migrate:ci` using `DATABASE_URL_PRODUCTION` (GitHub secret, optional: omit only if you migrate elsewhere)
- Railway deploy using pinned Railway CLI (`@railway/cli@4.40.0`) with:
  - `RAILWAY_TOKEN` (Actions **secret**)
  - `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE` (repository **Variables** — not Environment secrets, unless you duplicate them there; missing vars are the most common “deploy job didn’t start” / instant failure)
  - `RAILWAY_ENVIRONMENT` (repo variable, optional; maps to `railway up --environment`)

### If a push to `main` did not reach production (e.g. CI failed on an early PR)

1. **Fix or merge** the follow-up on `main` (typecheck / build must be green), then **push to `main`** so the workflow runs again.
2. Or: **Actions** → **CI/CD** → **Run workflow** → branch `main` → enable **`force_app_deploy`**. That re-runs **Neon migrate** and **`railway up`** for the current `main` without a new commit (e.g. a failed deploy, or a manual redeploy to pick up the same ref).
3. **Confirm the live revision:** `curl -sS https://usesophia.app/api/health | jq .app` — the JSON includes `version` and `git_sha` when the runtime can resolve a commit (commonly from Railway’s `RAILWAY_GIT_COMMIT_SHA` for Git-integrated services). If `git_sha` is `null`, you still have `version`; compare to `package.json` in the tag you expect, or set a deploy-time env per [Railway variables](https://docs.railway.com/reference/variables).

## 4) Custom domain cutover (`usesophia.app`)

1. In Railway service settings, add custom domain: `usesophia.app`.
2. Apply Railway-provided DNS records at DNS host.
3. Wait for Railway TLS/certificate status to become active.
4. Keep previous DNS target available until smoke checks pass.

## 5) Smoke test checklist

After deploy and DNS propagation:

1. `curl -i https://usesophia.app/api/health` returns `200`.
2. Open `https://usesophia.app` in browser and verify app shell loads.
3. Run one authenticated app request and one admin ingest request.
4. Confirm Railway logs show healthy startup and no boot-time env errors.

## 6) Rollback / contingency

- Railway rollback: redeploy last known-good deployment from Railway dashboard.
- DNS rollback: temporarily point `usesophia.app` back to prior target if needed.
- DB safety: migrations run before deploy in CI; if rollback is required, keep schema backward-compatible or ship follow-up migration.

## 7) Durable ingestion jobs (replaces Cloud Run `sophia-ingestion-job-poller`)

Durable **multi-URL** jobs and **re-embed** corpus jobs are advanced in Neon by `tickAllRunningIngestionJobs` / `tickAllRunningReembedJobs` (same as `pnpm ingestion:job-poller`, which runs `scripts/ingestion-job-poller.ts`). On Google Cloud that ran as a **separate** Cloud Run Job on a schedule; the main web service does not tick queues on its own.

**Pick one of these for production on Railway:**

1. **HTTP tick (lightweight, default).** The repo includes `.github/workflows/ingestion-job-tick.yml`, which `POST`s production every two minutes (GitHub’s schedule uses UTC; the workflow must exist on the **default** branch to run on a timer).

   - **Railway (production app):** set `INGESTION_JOB_TICK_SECRET` to a long random value (e.g. `openssl rand -hex 32`); redeploy or restart so the process sees it. This enables `POST /api/internal/ingest/jobs/tick` with `Authorization: Bearer <secret>`. (This path is **not** Neon user JWT auth — it is excluded in `hooks.server.ts` so the Bearer value is the shared tick secret, not a session token.)
   - **GitHub Actions:** in the repository **Settings → Secrets and variables → Actions**, add a secret **`INGESTION_JOB_TICK_SECRET`** with the **same** string as on Railway. Optionally set **`INGESTION_JOB_TICK_URL`** if the tick URL is not `https://usesophia.app/api/internal/ingest/jobs/tick` (staging, preview host, or path). Avoid a trailing newline when pasting (or rely on the workflow and server normalizing a single trailing newline).
   - After a deploy with the tick route, open **Actions → Ingestion job tick → Run workflow** once to confirm HTTP 200. If the run shows **HTTP 503** with `ingestion_job_tick_not_configured`, production is missing `INGESTION_JOB_TICK_SECRET` or you have not redeployed since adding it. **HTTP 401** means the token does not match Railway; fix both to the same value and redeploy if Railway was changed.
   - Alternative schedulers: Railway [cron](https://docs.railway.com/reference/cron-jobs) (if on your plan) or any external `curl` with the same `Authorization` header. Keep the shared secret out of the URL and logs.

2. **Dedicated worker process.** Add a second Railway service using the same image and env as the web app, with start command e.g. `npx --yes tsx scripts/ingestion-job-poller.ts --interval 5` (or use `Dockerfile.ingest-worker` which runs the poller). Size memory for concurrent `ingest.ts` children if the web app also spawns admin runs; in practice a separate worker avoids starving HTTP requests. Copy every secret the poller and ingest children need (same as `scripts/gcp/deploy-sophia-ingestion-poller-job.sh` on GCP: `DATABASE_URL`, Surreal, model keys, Restormel, etc.).

3. **Manual** — Admin can use **Advance all queues** in the jobs UI, but that is not suitable for unattended operation.

Nightly or other batch scripts (for example `scripts/ingest-nightly-links.ts`) are separate: schedule them the same way if you still run those flows.

**Durable job children** are always run with real `fetch-source` + `ingest.ts` (they carry `ingestion_job_id` in the payload) even if `ADMIN_INGEST_RUN_REAL` is unset. For **ad-hoc** admin runs from the ingest console, set `ADMIN_INGEST_RUN_REAL=1` on the Railway service, or the UI will simulate the pipeline (fast fake progress).

## 8) Google Cloud decommission note

Legacy GCP deployment scripts/docs are retained only as archival/teardown references. Production deploy is Railway-first.
