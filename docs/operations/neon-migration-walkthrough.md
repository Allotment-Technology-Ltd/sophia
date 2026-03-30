# Neon migration — beginner-friendly walkthrough

This guide walks you from “I have a Neon account” to “Sophia is using Neon for durable ingestion and (optionally) all non-auth operational data,” using the **terminal**, **Neon console**, and **Cursor (MCP + Agent)** where it helps.

**What stays in Firebase for now (typical rollout):** Firebase Auth for sign-in. Everything else described here can move to Neon per your product plan.

---

## How to use this document

| Column | Meaning |
|--------|---------|
| **You** | Manual steps in browser or editor |
| **Terminal** | Copy-paste commands (from repo root unless noted) |
| **Agent** | Prompts you can give Cursor’s agent to automate pieces |
| **MCP** | Neon MCP in Cursor (if enabled) — optional alternative to console/CLI |

Work through **phases in order**. Do not enable `SOPHIA_DATA_BACKEND=neon` in production until you have run migrations and smoke-tested (Phase 6–7).

---

## Concepts (30 seconds)

- **Neon project** — your Postgres host.
- **Branch** — Neon’s git-like DB branch (e.g. `main` for prod, `dev` for local).
- **`DATABASE_URL`** — connection string the app uses (pooler URL recommended for serverless).
- **`drizzle/0000_neon_first.sql`** — canonical schema in this repo (ingest tables + `sophia_documents`).
- **Two switches** — (1) `DATABASE_URL` enables durable **ingest orchestration + staging**; (2) `SOPHIA_DATA_BACKEND=neon` moves **`sophiaDocumentsDb`** off Google Firestore onto **`sophia_documents`** (Postgres).

---

## Phase 0 — Prerequisites

**You need:**

1. **Neon account** (you have this).
2. **This repo** cloned and dependencies installed: `pnpm install` (from repo root).
3. **Firebase Admin** working for Firestore migration (same as today):  
   - `GOOGLE_APPLICATION_CREDENTIALS` or a service-account path your `pnpm dev` already uses (see `.env.example`).
4. **Tools (optional but useful):**
   - `psql` — Postgres CLI ([install](https://www.postgresql.org/download/) or use Neon’s web SQL only).
   - `gh` — only if you track issues/PRs from CLI.

**Agent prompt (optional):**

```text
List all files under drizzle/ that define Neon schema migrations and summarize what each file creates. Do not edit files.
```

---

## Phase 1 — Create or choose a Neon project and database

### 1A — Using Neon console (recommended for first time)

1. Log in at [https://console.neon.tech](https://console.neon.tech).
2. **Create project** (or open an existing one).
3. Note the **default branch** (usually `main`).
4. Create a **database** if prompted (e.g. `neondb` or `sophia` — any name is fine).
5. Open **Connection details**:
   - Copy the **pooled** connection string if you deploy to serverless (Cloud Run, Vercel, etc.).
   - Copy the **direct** string only if you know you need it (long-lived workers).

**Important:** The connection string must include `?sslmode=require` (Neon usually appends this).

### 1B — Using Neon MCP in Cursor (optional)

If the **Neon MCP** server is connected in Cursor:

1. Open the MCP panel / use the Agent.
2. Typical tools include **`list_projects`** (and **`create_project`** when you need a new DB). The Agent can call them by name.

**Example agent prompt:**

```text
Using the Neon MCP tool list_projects only: list my Neon projects (limit 20). If none are suitable for Sophia, tell me to create one in the Neon console and what to name it—I will not paste secrets into chat.
```

Never paste **passwords** or full connection strings into public chats. Put them only in `.env` / secret stores.

### 1C — Enable `pgvector` (required for `VECTOR(768)` columns)

In Neon **SQL Editor**, run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If the migration file already contains this, applying `drizzle/0000_neon_first.sql` may run it again — that is safe with `IF NOT EXISTS`.

---

## Phase 2 — Apply the Sophia schema

Schema files live in the repo:

| File | Purpose |
|------|---------|
| `drizzle/0000_neon_first.sql` | Full initial schema (extensions, ingest orchestration, staging, `sophia_documents`) |
| `drizzle/0001_ingest_staging_source.sql` | Additive columns if `0000` was applied before those columns existed |

### Option A — Neon SQL Editor (beginner-friendly)

1. Open **SQL Editor** in Neon for the correct **branch**.
2. Open `drizzle/0000_neon_first.sql` in your editor, **copy entire file**, paste into Neon, **Run**.
3. If that succeeds, open `drizzle/0001_ingest_staging_source.sql`, copy, paste, **Run** (safe if columns already exist).

### Option B — `psql` from terminal

Install `psql` or use Neon’s connection string with:

```bash
# Replace with YOUR connection string (from Neon console, quoted for special chars)
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/DB?sslmode=require'

psql "$DATABASE_URL" -f drizzle/0000_neon_first.sql
psql "$DATABASE_URL" -f drizzle/0001_ingest_staging_source.sql
```

### Option C — Agent-assisted

**Agent prompt:**

```text
Do not print secrets. Assume DATABASE_URL is in my .env. Give me exact terminal commands to apply drizzle/0000_neon_first.sql and drizzle/0001_ingest_staging_source.sql using psql from the repo root, and how to verify tables exist with one SQL query.
```

### Verify tables exist

In Neon SQL Editor or `psql`:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'ingest_%' OR table_name = 'sophia_documents')
ORDER BY table_name;
```

You should see tables such as `ingest_runs`, `ingest_run_logs`, `ingest_staging_claims`, `sophia_documents`, etc.

---

## Phase 3 — Wire `DATABASE_URL` locally

1. Copy `.env.example` to `.env` if you have not already.
2. Add (or uncomment) **one line** in `.env`:

```bash
DATABASE_URL='postgresql://...your-neon-pooled-url...'
```

3. **Do not commit** `.env`.

**Sanity check (no secrets printed):**

```bash
pnpm db:ping
```

(Runs `SELECT 1` via Drizzle against Neon. Alternatively: `node -e "require('dotenv').config({path:'.env'}); require('dotenv').config({path:'.env.local'}); console.log(process.env.DATABASE_URL ? 'DATABASE_URL is set' : 'MISSING')"`.)

**Optional — quick DB ping via Drizzle/Neon:**

**Agent prompt:**

```text
Add a one-off script suggestion only: how to run pnpm check and a minimal tsx one-liner that imports getDrizzleDb and runs SELECT 1—without committing new files unless I ask.
```

---

## Phase 4 — Run the app with Neon-backed **ingestion only**

At this stage:

- Set **`DATABASE_URL`**.
- **Do not** set `SOPHIA_DATA_BACKEND=neon` yet (Google Firestore still serves the app document store).

This already enables:

- Durable **ingest run** state in Neon (orchestration, logs, issues, reports envelope).
- Admin ingest workers passing **`INGEST_ORCHESTRATION_RUN_ID`** so `scripts/ingest.ts` can write **staging** to Neon instead of only local `*-partial.json` (when the worker runs with real admin ingest).

**SurrealDB:** For real admin ingest, the worker uses **`--stop-before-store` by default**, so **stages 1–5 do not open SurrealDB** when `DATABASE_URL` and `INGEST_ORCHESTRATION_RUN_ID` are set—checkpoints live in Neon. You still need Surreal (or `docker compose up -d surrealdb` + `SURREAL_URL`) when you press **Sync to SurrealDB** (Stage 6) or for other app routes that query Surreal.

**Terminal:**

```bash
pnpm dev
```

**Smoke test (high level):**

1. Open admin ingest UI.
2. Start a **real** ingest (`ADMIN_INGEST_RUN_REAL=1` per your `.env.example` / ops docs).
3. Confirm in Neon **Table editor** or SQL that rows appear in `ingest_runs` for new runs.

**Agent prompt:**

```text
Point me to the env vars for ADMIN_INGEST_RUN_REAL and DATABASE_URL in .env.example and summarize what tables should gain rows when a run starts.
```

---

## Phase 5 — Migrate Firestore **top-level** documents into Neon

The repo includes a **semi-automated** migrator:

- Script: `scripts/migrate-firestore-to-neon.ts`
- Package script: `pnpm migrate:firestore-to-neon`

It copies **top-level Firestore collections** into `sophia_documents`.  
**Subcollections** under `users/...` are not fully recursive yet — plan extra work or a second pass if you need them on day one.

### 5A — Dry run (safe, default)

**Terminal:**

```bash
pnpm migrate:firestore-to-neon
```

Loads `.env` then `.env.local` (same as the app); no need for `tsx --env-file=…`.

This should print `[dry-run]` lines and **not** write to Neon.

### 5B — Migrate one collection (narrow blast radius)

**Terminal:**

```bash
pnpm migrate:firestore-to-neon -- --collection=api_keys --execute
```

(Adjust `--collection=` to match collections your script targets — see the script’s default list.)

### 5C — Full execute (all default collections)

**Terminal:**

```bash
pnpm migrate:firestore-to-neon -- --execute
```

**Requirements:**

- `DATABASE_URL` set.
- Firebase Admin can read Firestore (same as local dev).

**Agent prompt:**

```text
Read scripts/migrate-firestore-to-neon.ts and list the default collection names it migrates and any limitations stated in comments. Do not change the file.
```

---

## Phase 6 — Cut over `sophiaDocumentsDb` to Neon (staging first)

When migrated data looks correct:

1. On a **staging** branch deployment or local machine:

```bash
SOPHIA_DATA_BACKEND=neon
```

Add to `.env` (or hosting provider’s secret env).

2. Restart the app.

3. Smoke tests:
   - Admin pages that list Firestore-backed data (now `sophia_documents`).
   - API key flows, rate limits, billing — **whatever you migrated**.

**Rollback:** unset `SOPHIA_DATA_BACKEND` or set it to `firestore` (default) — see `.env.example` comments.

---

## Phase 7 — End-to-end ingest reliability (UI)

Goal: **99% reliable** operator flows without relying on in-memory state alone.

Checklist:

1. `DATABASE_URL` set everywhere the **API** runs.
2. `ADMIN_INGEST_RUN_REAL=1` where you want real workers.
3. Run an ingest, **kill** the worker mid-stage (or simulate failure), then use **Resume** in the UI.
4. Confirm:
   - Run rehydrates from Neon (`ingest_runs`, logs).
   - Staging tables updated (`ingest_staging_*`) for orchestrated runs.
5. Optional: change **models / batch overrides** on resume and confirm `payload_version` increases (see implementation in `ingestRuns.ts` / resume API).

**Agent prompt:**

```text
Trace the resume flow: admin UI → POST /api/admin/ingest/run/[id]/resume → ingestRunManager.resumeFromFailure. Summarize what is persisted in Neon vs memory. Cite file paths only, no secrets.
```

---

## Verify Neon stored orchestration + staging for one run

Admin worker logs show `orchestration run <16-char-hex>` — that value is the **`ingest_runs.id`** in Neon.

**CLI (recommended):** from repo root with `DATABASE_URL` in `.env` / `.env.local`:

```bash
pnpm verify:neon-ingest-run -- 7af94186543e7461
```

Prints row counts for `ingest_runs`, `ingest_run_logs`, `ingest_run_issues`, `ingest_staging_*`, and checks embedding coverage (`meta.embeddings_json` and/or pgvector on claims).

**Neon SQL editor** (same checks manually):

```sql
-- replace run id
select id, status, source_url, completed_at from ingest_runs where id = '7af94186543e7461';
select count(*) as log_lines, max(seq) as max_seq from ingest_run_logs where run_id = '7af94186543e7461';
select count(*) from ingest_staging_claims where run_id = '7af94186543e7461';
select count(*) from ingest_staging_relations where run_id = '7af94186543e7461';
select count(*) from ingest_staging_arguments where run_id = '7af94186543e7461';
select count(*) from ingest_staging_validation where run_id = '7af94186543e7461';
```

Compare staging counts to the **final** pipeline summary (e.g. 38 claims after Stage 6). Validation skipped → `ingest_staging_validation` usually **0** rows. **SurrealDB** truth for live graph data lives in Surreal after Sync; Neon holds **durable orchestration, logs, and checkpoints**.

---

## Phase 8 — Production secrets (Cloud Run / CI)

Sophia’s **GitHub Actions** deploy (`.github/workflows/deploy.yml`) expects:

| Item | Where |
|------|--------|
| `DATABASE_URL` | GCP Secret Manager secret **`neon-database-url`** (latest) → Cloud Run env `DATABASE_URL` |
| `SOPHIA_DATA_BACKEND=neon` | Plain env on the **`sophia`** Cloud Run service (set in the same `gcloud run deploy` step) |

**Migration mode:** GitHub Actions **does not run Pulumi** unless the repo variable **`ENABLE_PULUMI_IAC`** is set to `true`. Treat the **`gcloud run deploy`** step in `.github/workflows/deploy.yml` as the source of truth for Cloud Run env (including `DATABASE_URL` and `SOPHIA_DATA_BACKEND`). Re-enable Pulumi later when you settle the next IAC / cloud plan.

The `infra/` program still documents intent; optional local `pulumi` is described in [runbooks — Infra (Pulumi)](../reference/operations/runbooks.md).

### One-time (GCP console or gcloud)

1. Create the secret (use your **Neon pooled** URL; include `?sslmode=require` if not already in the string):

   ```bash
   printf '%s' 'postgresql://…' | gcloud secrets create neon-database-url --data-file=- --project=sophia-488807
   ```

   If the secret already exists, add a new version instead:

   ```bash
   printf '%s' 'postgresql://…' | gcloud secrets versions add neon-database-url --data-file=- --project=sophia-488807
   ```

2. Grant the **Cloud Run app** service account secret accessor (replace if your SA name differs):

   ```bash
   gcloud secrets add-iam-policy-binding neon-database-url \
     --project=sophia-488807 \
     --member="serviceAccount:sophia-app@sophia-488807.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

3. Run **`pnpm migrate:firestore-to-neon -- --execute`** against production Neon (from a trusted machine with Firebase Admin + `DATABASE_URL`) **before** or right after enabling `SOPHIA_DATA_BACKEND=neon`, so `sophia_documents` has the rows the app expects.

4. **Neon Auth:** set `USE_NEON_AUTH=1`, `NEON_AUTH_BASE_URL`, and build-time `VITE_NEON_AUTH_URL` (GitHub Actions uses repo secret `NEON_AUTH_BASE_URL`; Pulumi stacks can use Secret Manager `neon-auth-base-url`). Replace `admin-uids` / `owner-uids` with **Neon JWT `sub`** values, not legacy Firebase UIDs (see `docs/operations/neon-auth-migration.md`).

### Rollback

- Remove `SOPHIA_DATA_BACKEND` from the deploy env or set `SOPHIA_DATA_BACKEND=firestore`, redeploy; optionally stop mounting `DATABASE_URL` if you want ingest to skip Neon (not recommended if you rely on durable ingest).

### Not yet wired here

- **Cloud Run Jobs** (`sophia-ingest`, nightly) in Pulumi do not mount `DATABASE_URL` in this repo; add the same secret ref there if those jobs need Neon-backed behavior.

---

## Using Cursor Agent effectively (prompts pack)

Copy-paste and adjust:

1. **Schema audit**

   ```text
   Compare drizzle/0000_neon_first.sql to src/lib/server/db/schema.ts and say if they are intentionally in sync; list any drift. Do not edit files.
   ```

2. **Env audit**

   ```text
   List every process.env key read by src/lib/server/db/neon.ts and src/lib/server/neon/datastore.ts and sophiaDocumentsDb.ts for Neon / document-store routing. No secret values.
   ```

3. **Failure injection test plan**

   ```text
   Propose a minimal manual test matrix for: (a) deploy restart mid-run, (b) resume with new model_chain, (c) Stage 6 Surreal sync. Reference existing routes under src/routes/api/admin/ingest/.
   ```

4. **MCP Neon**

   ```text
   If Neon MCP is available, list Neon MCP tool names from the mcps folder and suggest which tool applies schema vs which creates a branch—without executing anything.
   ```

---

## Troubleshooting

| Symptom | Things to check |
|--------|-------------------|
| `DATABASE_URL is not set` | Add to `.env`; run `pnpm db:ping` to verify |
| `extension "vector" does not exist` | Run `CREATE EXTENSION vector;` on the **same** Neon branch you use in `DATABASE_URL` |
| `relation "ingest_runs" does not exist` | Re-run `0000_neon_first.sql` on the correct database |
| App works but no ingest rows | Real ingest not enabled (`ADMIN_INGEST_RUN_REAL`), or API not restarted after env change |
| `SOPHIA_DATA_BACKEND=neon` breaks reads | Data not migrated into `sophia_documents`, or wrong Neon branch |
| Migration script errors on Timestamp | Update script / Firestore SDK version; check Firebase Admin init |

---

## What this walkthrough does **not** cover (yet)

- **Full recursive** Firestore → Neon for every `users/{uid}/...` subcollection (extend `migrate-firestore-to-neon.ts` or add more scripts).
- **Neon Auth** replacing Firebase Auth — see `docs/operations/neon-auth-migration.md` and `src/lib/server/neon/neonAuthJwt.ts`.
- **SurrealDB long-term posture** — see `docs/decisions/surrealdb-posture-benchmark.md`.
- **BYOK KMS** off GCP — needs a separate security/architecture decision.

---

## Quick reference — files in this repo

| Topic | Location |
|-------|----------|
| SQL migrations | `drizzle/0000_neon_first.sql`, `drizzle/0001_ingest_staging_source.sql` |
| Drizzle schema | `src/lib/server/db/schema.ts` |
| Connection pool | `src/lib/server/db/neon.ts` |
| Ingest run persistence | `src/lib/server/db/ingestRunRepository.ts` |
| Staging read/write | `src/lib/server/db/ingestStaging.ts` |
| Firestore compat (optional) | `src/lib/server/neon/neonFirestoreCompat.ts` |
| Env flags | `.env.example` (Neon + `SOPHIA_DATA_BACKEND`) |
| Firestore → Neon migrator | `scripts/migrate-firestore-to-neon.ts`, `pnpm migrate:firestore-to-neon` |
| Short operator notes | `docs/operations/neon-first-rollout.md` |

---

## Success criteria (you’re “done” with this migration pass)

- [ ] Schema applied on the Neon branch you use in production.
- [ ] `DATABASE_URL` set in all runtime environments that run ingestion.
- [ ] At least one successful **UI** ingest with Neon rows visible for `ingest_runs`.
- [ ] Resume after failure works without losing the run in the admin UI after API restart (Neon rehydration).
- [ ] (If using full cutover) `SOPHIA_DATA_BACKEND=neon` validated on staging, then production, with migrated `sophia_documents` data.

When all boxes are checked for your environment, you have a **semi-automated, repeatable** Neon rollout aligned with the Sophia codebase.
