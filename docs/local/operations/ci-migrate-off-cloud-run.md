# CI: migrating off `.github/workflows/deploy.yml` Cloud Run

Today **one workflow** builds Docker, pushes to **Artifact Registry**, runs **Neon migrations**, and deploys **Cloud Run** ([deploy.yml](../../../.github/workflows/deploy.yml)). To host elsewhere without losing schema discipline:

## Keep Neon migrations authoritative

The job **`deploy-neon-migrate`** (same workflow) runs:

- `google-github-actions/auth` with WIF
- `pnpm db:migrate:ci` reading **`neon-database-url`** from Secret Manager

**When splitting CI:**

1. **Extract** (copy) the `deploy-neon-migrate` job’s steps into a reusable workflow (e.g. `.github/workflows/neon-migrate.yml`) *or* a first job in a new `vercel.yml` / `release.yml`.
2. Grant the **same** WIF service account **`secretmanager.secretAccessor`** on `neon-database-url` (see [`scripts/gcp/ensure-wif-neon-secret-access.sh`](../../../scripts/gcp/ensure-wif-neon-secret-access.sh)).
3. Run migrations **before** traffic sees new app code that depends on new columns (same ordering as today).

## Target-specific deploy

| Target | Build | Secrets | Migrations |
|--------|-------|---------|------------|
| **Vercel** | `vercel build` or Git integration | Vercel env / linked secrets | Separate GitHub Action calling `pnpm db:migrate:ci` on `push` to `main`, or Vercel deploy hook after migrate |
| **VPS** | `docker build` + registry or pull from GHCR | `.env` / Docker secrets | SSH or Actions runner on host: pull image → migrate → `docker compose up` |

## Validate after cutover

- `GET /api/health`
- Sign-in + Neon-backed routes
- Admin ingest smoke (or worker URL if retained)
- Surreal-backed read path (graph)

## GCP workflow lifecycle

- **Disable** or delete the `app-deploy` / `deploy-container-image` jobs when Cloud Run is retired, or add `if: false` temporarily while dual-running.
- Keep **`deploy-neon-migrate`** (or its extracted equivalent) until migrations live exclusively on the new pipeline.

This file is a checklist; it does not remove the existing Cloud Run pipeline by itself.
