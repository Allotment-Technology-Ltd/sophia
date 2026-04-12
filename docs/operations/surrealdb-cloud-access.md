# SurrealDB Cloud — credentials and access (Sophia)

**Secrets never live in git.** Use `.env` / `.env.local` (from [`.env.example`](../../.env.example)) or your secret manager (e.g. GCP Secret Manager `surreal-db-pass` in CI — see `.github/workflows/nightly-gate-audit.yml`).

---

## 1) Required environment variables

| Variable | Purpose |
|----------|---------|
| **`SURREAL_URL`** | Full WebSocket RPC URL. **Local:** `ws://localhost:8000/rpc`. **Cloud:** `wss://…/rpc` from the console. If this is set (non-empty), it **wins** over the split vars below. |
| **`SURREAL_INSTANCE`** | With **`SURREAL_HOSTNAME`**, used when **`SURREAL_URL` is unset**: builds `wss://<INSTANCE>.<HOSTNAME>/rpc` (same logic as `resolveSurrealRpcUrl()` in `src/lib/server/surrealEnv.ts`). Typical `.env.local` layout for Surreal Cloud. |
| **`SURREAL_HOSTNAME`** | Host part only (no `wss://`, no `/rpc`) unless you also set `SURREAL_URL`. |
| **`SURREAL_USER`** | Database user (commonly `root` on Cloud until you define scoped users). |
| **`SURREAL_PASS`** | Password for that user (set in Surreal Cloud / instance settings). |
| **`SURREAL_NAMESPACE`** | Namespace (Sophia uses `sophia` by default). |
| **`SURREAL_DATABASE`** | Database name inside the namespace (default `sophia`). |

**You do not need both** a full `SURREAL_URL` **and** `SURREAL_INSTANCE`/`SURREAL_HOSTNAME` unless you want an explicit override: **`SURREAL_URL` always takes precedence** when trimmed non-empty.

**Optional — same as `scripts/ingest.ts`:**

| Variable | Purpose |
|----------|---------|
| **`SURREAL_ACCESS`** or **`SURREAL_RECORD_ACCESS`** | If you use **access record** auth instead of root/password only, set the access name. The shared helper `signinSurrealWithFallback` in `scripts/lib/surrealSignin.ts` tries root, namespace-scoped, and access-based payloads (mirrors ingest). |
| **`SURREAL_AUTH_LEVEL`** | For the **Surreal CLI** only (`surreal export`, `surreal sql`): must match **where the credential lives in Surrealist** — **Root**, **Namespace**, or **Database** column. Defaults to **`root`**. Example: a system user shown only under **Database** (e.g. `importer` on `main` / `sophia`) needs **`database`**. A user under **Namespace** needs **`namespace`**. If this is wrong, the CLI often returns *There was a problem with authentication* while the JS SDK ingest path still works. See [CLI export](https://surrealdb.com/docs/surrealdb/cli/export) `--auth-level`. Loaded by `scripts/surreal-cli-env.sh`. |
| **`SURREAL_TOKEN`** | Optional JWT for CLI **`--token`** instead of username/password (advanced). |

**HTTPS URLs:** if you paste an `https://…` endpoint from a dashboard, tools in this repo normalise it to **`wss://…/rpc`** for the JavaScript SDK (`normalizeSurrealRpcUrl` in `src/lib/server/surrealEnv.ts`).

---

## 2) Node SDK (recommended for scripts)

Scripts use the **`surrealdb`** npm package (`package.json` dependency).

- **Volume / G0 audit:** `pnpm ops:audit-ingest-training-volume` — loads `.env` / `.env.local` via `loadServerEnv()`, resolves the RPC URL with **`resolveSurrealRpcUrl()`** (`src/lib/server/surrealEnv.ts`), then **`signinSurrealWithFallback`** (`scripts/lib/surrealSignin.ts`, same sign-in sequence as `scripts/ingest.ts`).
- **Ingest worker:** `scripts/ingest.ts` — `reconnectDbWithRetry` / `signinSurrealWithFallback` (source of truth; keep in sync with `scripts/lib/surrealSignin.ts` when adding new auth modes).

If authentication still fails:

1. Confirm **`SURREAL_PASS`** matches the **current** Cloud password (rotate in console → update local env).  
2. Confirm **namespace/database** exist and match Cloud.  
3. Try **`SURREAL_ACCESS`** if your instance uses access-record sign-in only.

---

## 3) Surreal CLI (optional)

Install the [Surreal CLI](https://surrealdb.com/docs/surrealdb/installation) (`brew install surreal` on macOS, or download a release binary).

**Cloud console exports:** the dashboard export flow may warn that the environment **does not support streaming exports** and to use the CLI for larger datasets — use **`surreal export`** below instead of relying on the browser for big graphs.

**Full / large backup (`surreal export`):** writes a SurrealQL script (see [Export command](https://surrealdb.com/docs/surrealdb/cli/export)). **`--namespace` and `--database` are mandatory** — running `surreal export` alone prints `required arguments were not provided`.

**Loading env:** do **not** `source .env` for CLI backup — lines like `DATABASE_URL=...&...` break the shell (`parse error near '&'`). From repo root, export only Surreal keys via **`scripts/surreal-cli-env.sh`**, which loads **`.env` then `.env.local`** (overrides on duplicate keys). **`SURREAL_NAMESPACE` / `SURREAL_DATABASE` may live only in `.env.local`** — the script still picks them up.

```bash
. ./scripts/surreal-cli-env.sh

mkdir -p backups
surreal export \
  --endpoint "$SURREAL_URL" \
  --username "$SURREAL_USER" \
  --password "$SURREAL_PASS" \
  --auth-level "${SURREAL_AUTH_LEVEL:-root}" \
  --namespace "${SURREAL_NAMESPACE:-sophia}" \
  --database "${SURREAL_DATABASE:-sophia}" \
  ./backups/sophia-export.surql
```

Relabel checklist: [`ingestion-relabel-runbook.md`](./ingestion-relabel-runbook.md) §2.

**Interactive SQL** (read-only queries are fine for audits). If `SURREAL_*` is not already in your shell, run `. ./scripts/surreal-cli-env.sh` first (same as export above).

```bash
surreal sql --endpoint "$SURREAL_URL" --username "$SURREAL_USER" --password "$SURREAL_PASS" \
  --auth-level "${SURREAL_AUTH_LEVEL:-root}" --namespace "$SURREAL_NAMESPACE" --database "$SURREAL_DATABASE"
```

Use a **`wss://`…`/rpc`** value for `--endpoint` on Cloud (or `ws://` locally). If your shell only has `https://`, replace the scheme with **`wss://`** and append **`/rpc`** if missing.

**One-shot query** (example — distinct sources with claims):

```bash
surreal sql --endpoint "$SURREAL_URL" --username "$SURREAL_USER" --password "$SURREAL_PASS" \
  --auth-level "${SURREAL_AUTH_LEVEL:-root}" \
  --namespace "$SURREAL_NAMESPACE" --database "$SURREAL_DATABASE" \
  --pretty <<'EOF'
SELECT count() AS c FROM claim GROUP ALL;
EOF
```

---

## 4) GCP / production alignment

- **Cloud Run / workers:** `SURREAL_URL`, `SURREAL_USER`, `SURREAL_PASS` are typically injected from Secret Manager (see `scripts/run-wave-gcp.sh` for env-var wiring patterns).  
- **Local → private Cloud IP:** `.env.example` documents **`DEV_SURREAL_TUNNEL`** for reaching a VPC-only endpoint via `gcloud compute ssh` port-forward.

---

## 5) Related docs

- [Ingestion fine-tune data mitigation plan](./ingestion-fine-tune-data-mitigation-plan.md) §3.2 — Surreal counts for **G0**.  
- [Argument graph schema](../reference/architecture/argument-graph.md) — `source` / `claim` tables.  
- [Graph RAG + ingestion overview](../sophia/graph-rag-and-ingestion-architecture-overview.md) — Neon vs Surreal roles.
