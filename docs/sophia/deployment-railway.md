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
- `NEON_AUTH_BASE_URL` (or **`NEON_AUTH_URL`**) — when set, Neon Auth is **on** even if `USE_NEON_AUTH` is omitted; set `USE_NEON_AUTH=0` to disable
- (Optional) `USE_NEON_AUTH=1` if you want to be explicit
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
- `RESTORMEL_ENVIRONMENT_ID`
- `RESTORMEL_KEYS_BASE`
- `RESTORMEL_BASE_URL`
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

`.github/workflows/deploy.yml` deploys production to Railway on `main` pushes:

- security + quality checks
- `pnpm db:migrate:ci` using `DATABASE_URL_PRODUCTION` (GitHub secret)
- Railway deploy using pinned Railway CLI (`@railway/cli@4.40.0`) with:
  - `RAILWAY_TOKEN` (GitHub secret)
  - `RAILWAY_PROJECT_ID` (repo variable, required)
  - `RAILWAY_SERVICE` (repo variable, required)
  - `RAILWAY_ENVIRONMENT` (repo variable, optional)

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

## 7) Google Cloud decommission note

Legacy GCP deployment scripts/docs are retained only as archival/teardown references. Production deploy is Railway-first.
