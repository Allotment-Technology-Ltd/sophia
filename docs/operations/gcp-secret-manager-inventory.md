# GCP Secret Manager — Cloud Run `sophia` inventory

Source of truth for names: [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) (`gcloud run deploy … --set-secrets=…`).

**Bootstrap (production):** enable APIs (`pnpm gcp:enable-apis`), grant WIF deploy SA access to `neon-database-url` (`pnpm gcp:ensure-wif-neon-access`), then rely on CI to migrate Neon, deploy `sophia`, and update job `sophia-ingestion-job-poller`. Optional scheduler: `pnpm gcp:setup-ingestion-poller-scheduler`. Details: [`gcp-infrastructure.md`](./gcp-infrastructure.md).

**Important:** Google Secret Manager stores **one payload per secret name**. Cloud Run maps each secret to **one** environment variable. There is no supported “upload one file and auto-split” for this deploy path—you create **one secret per row** below (or use your own automation that calls the API once per secret).

**Not in Secret Manager (GitHub Actions / plain env on deploy):** `NEON_AUTH_BASE_URL`, optional `SURREAL_RPC_URL`, Restormel vars, Workload Identity, etc.—see deploy workflow `set-env-vars` and repository **Settings → Secrets and variables → Actions**.

**Optional duplicate in Secret Manager:** secret **`neon-auth-base-url`** can hold the same Neon Auth `base_url` as GitHub **`NEON_AUTH_BASE_URL`** if you ever mount it from SM instead of plain deploy env (today’s `deploy.yml` uses the GitHub secret for `NEON_AUTH_BASE_URL`).

---

## Required secrets for production Cloud Run (`sophia`)

| Secret Manager name (create with this ID) | Becomes env var on Cloud Run | What to put in the secret |
|-------------------------------------------|------------------------------|---------------------------|
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-…`) |
| `voyage-api-key` | `VOYAGE_API_KEY` | Voyage API key |
| `google-ai-api-key` | `GOOGLE_AI_API_KEY` | Google AI Studio key (Gemini) |
| `surreal-db-pass` | `SURREAL_PASS` | SurrealDB password (Surreal Cloud or self-hosted root user) |
| `neon-database-url` | `DATABASE_URL` | Neon Postgres connection string (pooled URL recommended) |
| `admin-uids` | `ADMIN_UIDS` | Comma-separated **Neon Auth JWT `sub`** values (admin / machine identities) |
| `owner-uids` | `OWNER_UIDS` | Comma-separated **Neon Auth JWT `sub`** (operator BYOK bucket; first id is primary) |
| `PADDLE_API_KEY_PRODUCTION` | `PADDLE_API_KEY_PRODUCTION` | Paddle server API key (live) |
| `PADDLE_WEBHOOK_SECRET_PRODUCTION` | `PADDLE_WEBHOOK_SECRET_PRODUCTION` | Paddle webhook signing secret (live) |
| `PADDLE_PRICE_PRO_GBP_PRODUCTION` | `PADDLE_PRICE_PRO_GBP_PRODUCTION` | Paddle price id (Pro, GBP) |
| `PADDLE_PRICE_PRO_USD_PRODUCTION` | `PADDLE_PRICE_PRO_USD_PRODUCTION` | Paddle price id (Pro, USD) |
| `PADDLE_PRICE_PREMIUM_GBP_PRODUCTION` | `PADDLE_PRICE_PREMIUM_GBP_PRODUCTION` | Paddle price id (Premium, GBP) |
| `PADDLE_PRICE_PREMIUM_USD_PRODUCTION` | `PADDLE_PRICE_PREMIUM_USD_PRODUCTION` | Paddle price id (Premium, USD) |
| `PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION` | `PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION` | Paddle price id (small top-up, GBP) |
| `PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION` | `PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION` | Paddle price id (small top-up, USD) |
| `PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION` | `PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION` | Paddle price id (large top-up, GBP) |
| `PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION` | `PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION` | Paddle price id (large top-up, USD) |
| `PADDLE_CLIENT_TOKEN` | `PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION` | Paddle **client-side** token (publishable; still stored as a secret here) |

---

## Optional / other surfaces (not in main `deploy.yml` line)

| Secret | Used for |
|--------|----------|
| `neon-auth-base-url` | Optional: same value as `NEON_AUTH_BASE_URL` if you bind auth URL from Secret Manager |
| `api-key-hash-secret` | Some API-key verification paths / runbooks—only if your revision mounts it |

---

## Grant Cloud Run access

The Cloud Run service account (e.g. `sophia-app@PROJECT_ID.iam.gserviceaccount.com`) needs **`roles/secretmanager.secretAccessor`** on each secret (or project-wide, as you prefer).

The **GitHub Actions deploy** service account (Workload Identity — e.g. `github-deploy@PROJECT_ID.iam.gserviceaccount.com`) also needs **`secretmanager.secretAccessor` on `neon-database-url`** so the deploy workflow can run `pnpm db:migrate:ci` before pushing a new revision.

---

## Add or rotate a secret (CLI)

Replace `PROJECT_ID` and paste the value when prompted (avoid echoing secrets in shell history—prefer `--data-file=-` from a temp file you delete).

```bash
PROJECT_ID=your-gcp-project

# First time only — create the secret container:
gcloud secrets create anthropic-api-key --project="$PROJECT_ID" --replication-policy=automatic

# Add a new version (rotate):
printf '%s' 'PASTE_VALUE_HERE' | gcloud secrets versions add anthropic-api-key \
  --project="$PROJECT_ID" --data-file=-
```

Repeat with the correct **secret name** from the table for each row.

---

## Local worksheet (fill in, then push each value separately)

Use this as a **private** checklist on your machine. **Do not commit** a filled copy to git.

```
anthropic-api-key:
  <single line, no quotes>

voyage-api-key:
  <single line>

google-ai-api-key:
  <single line>

surreal-db-pass:
  <single line>

neon-database-url:
  <full postgres URL, one line>

admin-uids:
  <comma-separated Neon subs>

owner-uids:
  <comma-separated Neon subs>

PADDLE_API_KEY_PRODUCTION:
  <single line>

PADDLE_WEBHOOK_SECRET_PRODUCTION:
  <single line>

PADDLE_PRICE_PRO_GBP_PRODUCTION:
  <price id>

PADDLE_PRICE_PRO_USD_PRODUCTION:
  <price id>

PADDLE_PRICE_PREMIUM_GBP_PRODUCTION:
  <price id>

PADDLE_PRICE_PREMIUM_USD_PRODUCTION:
  <price id>

PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION:
  <price id>

PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION:
  <price id>

PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION:
  <price id>

PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION:
  <price id>

PADDLE_CLIENT_TOKEN:
  <client token string>
```

Optional:

```
neon-auth-base-url:
  <same as Neon branch auth base_url, ends with /…/auth>
```

After each block, run `gcloud secrets versions add SECRET_NAME --data-file=-` (or create the secret first if missing).
