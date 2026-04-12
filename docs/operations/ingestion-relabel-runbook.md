# Ingestion relabel runbook (§9.5)

Operational steps for **re-ingesting existing Surreal sources** so claims match **Mistral extraction** (and Neon `stage_models.extraction` proves it). Legal sign-off and Restormel routes are prerequisites — see [`ingestion-fine-tune-data-mitigation-plan.md`](./ingestion-fine-tune-data-mitigation-plan.md) §9.

## 1. Inventory (M9.13)

From repo root with Surreal env set. The script uses **`resolveSurrealRpcUrl` + `signinSurrealWithFallback`** (same as `scripts/ingest.ts`): Cloud-friendly URL (`SURREAL_URL` or `SURREAL_INSTANCE` + `SURREAL_HOSTNAME`), then root/namespace/access-record signin attempts. Secrets often live in **`.env.local`** — the script calls `loadServerEnv()` so `.env` is merged first, then **`.env.local` overrides** (same as the app). `tsx --env-file=.env` only preloads `.env`; `.env.local` is still picked up inside the script.

```bash
pnpm ops:relabel-inventory
```

If you see **“There was a problem with authentication”** on **`surreal export`** / **`surreal sql`** while **`pnpm ops:relabel-inventory`** works: the CLI defaults to **`--auth-level root`**. Ingest uses **`signinSurrealWithFallback`**, which tries several signin shapes; the CLI needs the level to match **where the user is defined in Surrealist** — **Root** vs **Namespace** vs **Database** columns. A **system user listed only under Database** (e.g. **`importer`** on namespace **`main`** / database **`sophia`**) needs **`SURREAL_AUTH_LEVEL=database`**, not `namespace`. If the user sits under Namespace, use **`namespace`**. Put **`SURREAL_AUTH_LEVEL=…` in `.env.local`** (not only a transient shell assign), run `. ./scripts/surreal-cli-env.sh`, and keep **`--auth-level "${SURREAL_AUTH_LEVEL:-root}"`** on the CLI (§2). Also verify `SURREAL_USER` / `SURREAL_PASS`, optional **`SURREAL_ACCESS`**, and **`SURREAL_URL`** is **`wss://…/rpc`**.

Outputs:

- `data/relabel-inventory.json` — `{ rows: [{ source_id, url, canonical_url_hash, ingested_at, … }] }`
- `data/relabel-inventory.csv` — same columns for spreadsheets

Options:

```bash
pnpm exec tsx --env-file=.env scripts/relabel-programme.ts inventory --status=ingested --limit=10 --format=json
```

### Surreal-only vs Neon-orchestrated (training scope)

Many **`source`** rows in Surreal were ingested **before Neon orchestration existed**, via **CLI / batch paths**, or from **non-SEP** (and other) corpora that never produced matching **`ingest_runs`** rows. For **fine-tune and supervision exports that require Neon provenance** (`report_envelope` / `stage_models.extraction`, etc.), treat those sources as **out of scope** unless you deliberately **re-run them through the current Neon-backed pipeline** and adopt the new run metadata.

`pnpm ops:relabel-neon-map` marks each inventory row with **`has_neon_completed_ingest`** (`true` only when a `done` Neon run matches after URL variant matching). Filter exports with **`has_neon_completed_ingest === true`** when you need Neon-aligned training data; unmatched rows are **not** a tooling failure.

## 2. Backup before destructive work (M9.14)

Before **deleting or replacing** claims in Surreal:

- **Surreal Cloud UI:** the export dialog may show *“Your environment does not support streaming exports. For larger exports, please use the SurrealDB CLI.”* Treat that as authoritative for anything beyond a tiny export — **use the CLI** (below) or your provider’s instance backup feature.
- **SurrealDB CLI (recommended for relabel-sized graphs):** install the [Surreal CLI](https://surrealdb.com/docs/surrealdb/installation), then export a SurrealQL script (schema + data) with [`surreal export`](https://surrealdb.com/docs/surrealdb/cli/export). From repo root with the same `SURREAL_*` vars as ingest (see [`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md)).

  **`surreal export` with no flags always fails** — the CLI requires **`--namespace`** and **`--database`** (plus endpoint and auth). If you see `required arguments were not provided: --namespace … --database …`, either load Surreal env (below) or pass literals, e.g. `--namespace sophia --database sophia`.

  **Do not `source .env` / `source .env.local` for this.** Dotenv files are not guaranteed to be valid shell; values such as `DATABASE_URL=...&channel_binding=require` contain **`&`**, which makes the shell report `parse error near '&'` and leaves `SURREAL_*` unset — then **`surreal export`** fails with **authentication** errors. Use the repo helper that exports only **`SURREAL_*`** lines. It reads **`.env` then `.env.local`** (local wins on duplicates), same as the app — **`SURREAL_NAMESPACE` / `SURREAL_DATABASE` only in `.env.local` is supported.**

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
  "backups/sophia-surreal-pre-relabel-$(date +%Y%m%d-%H%M).surql"
```

Use a **`wss://…/rpc`** endpoint on Cloud (same normalisation as other tools). **`--auth-level` must match Surrealist:** database-scoped users → **`database`**; namespace-scoped → **`namespace`**; instance root → **`root`** (default). For a **smaller** smoke backup you can scope tables, e.g. `--tables source claim` plus edge tables you care about — see `surreal export --help` and `--only`.

- Alternatively: snapshot the **namespace/database** in the Cloud console (if offered) and verify restore.

Do **not** skip backup for full-corpus relabel.

## 3. Strategy (M9.15)

**A — Full re-ingest (queue / operator “from URL”):** Re-queue each URL through **durable ingestion jobs** or admin flows that **fetch** the page again, then run ingest end-to-end. Use when **`data/sources/<slug>.txt` is missing** or you want a **fresh fetch** (content drift, recovery after bad local copy).

**B — Extraction-forward replay (no URL re-fetch when text already exists):** Run **`scripts/ingest.ts`** on an existing **`data/sources/<slug>.txt`** (plus sibling **`.meta.json`**) with **`--force-stage extracting`**. That **re-runs from Mistral extraction through store** (relations, grouping, embedding, validation, store) — it does **not** re-download the source from the network because ingest reads the body from disk. If the **`.txt` is gone** but Neon still has the body for an orchestrated run, set **`INGEST_ORCHESTRATION_RUN_ID`** to that run’s id and pass the same slug path: **`loadSourceTextAndMeta`** can load **`source_text_snapshot`** from **`ingest_staging_meta`** (see `scripts/ingest.ts` — “Loaded source body from Neon checkpoint”). **`scripts/replay-ingest.ts`** is a thin wrapper: Surreal **`ingestion_log`** by **`canonical_url_hash`**, resolve local **`.txt`**, then spawn **`ingest.ts`** with optional **`--force-stage`**.

**How this differs from “full re-ingest”:** For many Sophia sources you **already have** `data/sources/*.txt` from the original fetch. **B** is then enough for relabel: you are **not** required to enqueue **A** just to get new extraction — **A** adds value mainly when you need a **new fetch** or standardisation on the **durable job** path. You still pay **LLM cost** for every stage from **extracting** onward.

**Scope caveat:** rows with **`has_neon_completed_ingest: false`** (see §1) never had Neon staging for that URL — **Neon snapshot replay** is unavailable; use **local `.txt`** if it exists, or fall back to **A**.

## 4. Pilot then batch (M9.16–M9.17)

### 4.1 Pilot — Approach **B** (5–10 sources)

1. **§2 backup** done; Mistral / `INGEST_FINETUNE_LABELER_*` env matches production intent (see mitigation plan §9).
2. Build a short list from **`data/relabel-inventory.csv`** (or JSON): prefer URLs with **`has_neon_completed_ingest: true`** in **`pnpm ops:relabel-neon-map`** output if you want Neon-aligned audits later. Map each row to **`data/sources/<slug>.txt`** (slug from filename). If **`replay-ingest.ts`** is easier, use **`--canonical-url-hash`** from inventory when **`ingestion_log`** is populated for that source.
3. For each slug:

   ```bash
   pnpm exec tsx --env-file=.env scripts/ingest.ts "data/sources/<slug>.txt" --force-stage extracting
   ```

   Optional: **`--validate`**, **`--ingest-provider …`**, or **`INGEST_ORCHESTRATION_RUN_ID=<uuid>`** when loading body **only** from Neon (local `.txt` missing).

4. Compare **claim counts** / spot-check vs the **§2** snapshot; re-run **`pnpm ops:relabel-neon-map`** and expect **`mistral_extraction_hits_on_inventory`** to move for matched rows.

### 4.2 Batch — Approach **A** (durable ingestion jobs)

**Definitive SEP URL list (from Surreal `source`, not the full SEP catalog):**

```bash
pnpm ops:relabel-sep-list
```

Writes **`data/sep-reingest-sources.json`** (full rows: `source_id`, `url`, `canonical_url`, `source_type`, …) and **`data/sep-reingest-sources-urls.txt`** (one **canonical** URL per line, deduped). Selection rule: **`source_type = sep_entry`** **or** URL contains **`plato.stanford.edu`** and **`/entries/`** (covers legacy rows missing `source_type`). Default **`--status=ingested`**; use **`--status=all`** to include pending/quarantined/etc.

**Why durable jobs would otherwise “do nothing”:** `scripts/ingest.ts` exits early when Surreal **`ingestion_log`** is **`complete`** for that URL unless **`--force-stage …`** is set (`[SKIP] already ingested`). The admin worker **does not** pass `--force-stage` today.

**Fix — set job `workerDefaults`:**

```json
{ "forceReingest": true, "ingestProvider": "mistral" }
```

That injects **`INGEST_FORCE_REINGEST=1`** into the child, which is treated as **`--force-stage extracting`** (re-run from extraction through store after fetch). Operators can also export **`INGEST_FORCE_REINGEST=1`** for manual **`ingest.ts`** runs.

On **Admin → Ingest → Durable jobs** (`/admin/ingest/jobs`), **Worker defaults** now opens with **Re-ingest** checked and **Ingest provider** set to **mistral** (stored in `localStorage` per browser after you change anything). Turn **Re-ingest** off only for net-new URLs that are not already `complete` in Surreal `ingestion_log`.

Create the job from that UI (or API) with URLs from **`sep-reingest-sources-urls.txt`**, then run the poller / tick as you do today. Tune concurrency:

- `ADMIN_INGEST_MAX_CONCURRENT` / job `concurrency`
- `INGEST_JOB_LAUNCH_JITTER_MS`
- Surreal write caps (`INGEST_CLAIM_INSERT_CONCURRENCY`, etc.)

### 4.3 Batch — Approach **B** at scale

After pilot sign-off, scale with the same **`ingest.ts … --force-stage extracting`** pattern (shell loop, tmux, or small driver script) when **`data/sources/<slug>.txt`** already exists for each URL.

## 5. Post-batch audit (M9.18)

```bash
pnpm ops:audit-ingest-extraction-models-neon
```

Map inventory URLs to **latest done** Neon run extraction (read-only):

```bash
pnpm ops:relabel-neon-map
```

Review `data/relabel-neon-extraction-by-url.json`. **`neon-map` matches** `ingest_runs.source_url` against each row’s **`url`**, **`canonical_url`**, and **canonicalized** forms (trailing slash, etc.). Summary fields: `inventory_rows_matched_to_neon`, `mistral_extraction_hits_on_inventory`. After Mistral relabel, the latter should approach the number of matched rows.

## 6. Training export sidecar (M9.19)

Generate a **template** aligned with export rows (fill timestamps/models after each source completes):

```bash
pnpm ops:relabel-sidecar
```

Commit filled sidecar **per export shard**; never mix pre-relabel and post-relabel shards in one training bucket. When building shards from **`relabel-neon-extraction-by-url.json`**, restrict to rows with **`has_neon_completed_ingest: true`** if the export must be Neon-provenance-complete (see **Surreal-only vs Neon-orchestrated** above).

## Related scripts

| Script | Role |
|--------|------|
| [`scripts/relabel-programme.ts`](../../scripts/relabel-programme.ts) | Inventory, **`sep-reingest-list`**, Neon map, training sidecar template |
| [`scripts/ingest.ts`](../../scripts/ingest.ts) | Ingest pipeline; **`--force-stage extracting`** for Approach **B** |
| [`scripts/replay-ingest.ts`](../../scripts/replay-ingest.ts) | Resolve **`ingestion_log`** + local **`data/sources/*.txt`**, spawn **`ingest.ts`** |
| [`scripts/build-reingestion-manifest.ts`](../../scripts/build-reingestion-manifest.ts) | Richer manifest (local files + source lists + DB join) for cutover planning |
