# Ingestion fine-tune — data volume, ToS, Neon & Surreal (mitigation plan)

**Purpose:** single place for **G0 (volume) → G1 (label ToS)** ordering, **Neon vs Surreal** roles, **minimal mitigations**, and **executable audits** while counsel confirms provider terms (Risk 1 in [`sophia-technical-review.md`](./sophia-technical-review.md)). **Latest measured numbers:** **§8**. **ToS-aligned Mistral extraction + relabel programme:** **§9**.

**Not legal advice.** Current OpenAI / Anthropic / any labeler ToS and counsel win over this document.

---

## Executive summary

1. **Nothing else matters until G0 passes:** if you do not have **enough clean, deduped `(input → extraction JSON)` units** after measurement, **stop** — no fine-tune spike, no Surreal “workaround”, no infra spend (see [`sophia-technical-review.md`](./sophia-technical-review.md) §C minimums). **§8 (2026-04-11):** current Neon proxy **N ≈ 62** distinct URLs; Surreal **111** sources with claims — both in the **red** band.
2. **G1 is separate and sequential:** even with enough volume, **production labels** from **OpenAI / Anthropic** (confirmed dominant in Neon for extraction — §G.1 in the technical review) are **likely unusable** as training targets for another vendor’s model **unless** ToS explicitly allows it or you **regenerate** labels with a **policy-clear** generator.
3. **Surreal is not a loophole:** stored `claim` / `source` rows are **the same derived outputs** as Neon staging; they do not reset ToS risk.
4. **Operational artefacts:** run the two `pnpm ops:audit-*` commands on **Day 1** and archive outputs (see **§8** for the latest captured snapshot).
5. **Mistral API key + credit alone is not enough:** you must (a) **route extraction** (and extraction-stage fallbacks) to Mistral so **new** runs emit Mistral-attributable JSON, (b) **archive current Mistral ToS** language on using outputs for training, (c) **regenerate** extraction for **existing** sources if those rows must count as training-eligible — see **§9**.

---

## 1) Gate order (do not skip)

| Order | Gate | Question | If it fails |
|------|------|----------|-------------|
| **G0** | **Volume** | After dedupe and quality filters, do we have **enough** training units? | **Stop.** Grow corpus (ingest breadth, history, imports); re-run §3. No training, no label-regeneration at scale until this clears. |
| **G1** | **ToS / provenance** | May **existing** production JSON be used as **supervision** for a **different** model? | **Do not** export or train on Neon/Surreal extraction-shaped JSON until cleared or **relabelled** (§4). |

**Orientation thresholds** (from technical review; tune after your first G0 count):

| Tier | Approx. clean deduped pairs | Interpretation |
|------|----------------------------|----------------|
| **Red** | **&lt; ~300** | Training unlikely to beat a strong baseline; treat spike as **blocked**. |
| **Amber** | **~300–800** | Possible **pilot** only; high variance; tighten schema + faithfulness filters. |
| **Green** | **~800–1,500+** | More realistic for **schema-stable** extraction QLoRA / LoRA. |

Your **Neon proxy** is **distinct `source_url`** among completed runs in a window — **dedupe collapses** retries/re-ingests, so **effective** training units are **≤ distinct URLs** (and often lower after quality filters).

---

## 2) Where data lives (Neon vs Surreal)

| Layer | Tables / documents | Training use |
|-------|---------------------|--------------|
| **Neon** | `ingest_runs` (`source_url`, `payload`, `report_envelope`), `ingest_run_logs`, **`ingest_staging_meta`** (`source_text_snapshot`, progress JSON), **`ingest_staging_claims`** (per-run claim rows + `claim_data` JSON) | **Best place to count “how many runs could become pairs”** and to read **`timingTelemetry.stage_models.extraction`** for **G1**. Staging gives **reconstructable (text, JSON)** without Surreal for many runs. |
| **SurrealDB** | `source`, `claim`, edges (`relation`, …), embeddings | **Ground truth for what shipped** to the product graph. Counts answer “how big is the live corpus?” — **not** “ToS-safe labels.” Same pipeline provenance as Neon. |

Architecture: Neon = **orchestration + staging**; Surreal = **authoritative graph** after store — see [`graph-rag-and-ingestion-architecture-overview.md`](../sophia/graph-rag-and-ingestion-architecture-overview.md) §5.2–5.3.

---

## 3) G0 — volume review (commands + interpretation)

### 3.1 Neon (always run)

```bash
pnpm ops:audit-ingest-training-volume
pnpm exec tsx scripts/audit-ingest-training-volume.ts -- --days=365
```

**What it prints:**

| Field | Meaning |
|-------|---------|
| `completed ingest runs` | Raw **run** cardinality (retries inflate vs sources). |
| `distinct source_url` | **Upper bound** on unique **sources** in the window (dedupe key #1). |
| `runs w/ staging text snapshot ≥200 chars` | Runs where **`ingest_staging_meta.source_text_snapshot`** is probably usable as **input** text (length heuristic; tune if needed). |
| `runs w/ ≥1 ingest_staging_claims row` | Runs where **structured extraction output** exists in Neon (candidate **targets** for mining — **G1** still applies). |
| `runs w/ report_envelope.timingTelemetry` | Telemetry persisted for **model provenance** and timing. |
| `distinct URLs appearing in >1 run` | **Dedupe pressure** (same URL re-ingested). |

**Decision rule:** compare **distinct `source_url`** (after **you** apply URL-normalisation / hash dedupe beyond exact string match) to the **Red / Amber / Green** table in §1. If you are deep in **Red**, **everything else is off the table** until the corpus grows.

### 3.2 Surreal (optional; same credentials as ingest)

If **`SURREAL_URL`** or **`SURREAL_INSTANCE` + `SURREAL_HOSTNAME`** (see [`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md)) resolves and auth succeeds, the script prints **all-time** (instance-scoped) counts:

- **`sources`** table size  
- **`claims`** table size  
- **`SELECT source FROM claim GROUP BY source`** row count = **distinct sources that have ≥1 claim**

**If Surreal auth fails** in your shell, see **[`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md)** (correct `wss://` URL, password rotation, optional `SURREAL_ACCESS`). The Neon section still stands alone without Surreal.

**Manual SurrealQL** (Surrealist, **Surreal CLI**, or `curl` to `/sql` — see [`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md) §3):

```surql
SELECT count() AS c FROM source GROUP ALL;
SELECT count() AS c FROM claim GROUP ALL;
SELECT source FROM claim GROUP BY source;
```

**Reconciling Neon vs Surreal:** Neon **completed runs** can exceed Surreal **sources with claims** if many runs **never reached store**, **failed validation**, or **point at a different Surreal instance**. Use Neon for **“what we could mine from orchestration”** and Surreal for **“what users actually see in the graph.”** For **training manifest** design, pick **one** authority for “included in training set” and stick to it (usually **canonical URL hash** aligned with `scripts/ingest.ts` / `source.canonical_url_hash`).

### 3.3 Quality filters (still G0 — shrink the count)

Before comparing to thresholds, apply at least:

1. **Schema validator** on candidate JSON (technical review §C — discard invalid rows).  
2. **Non-empty extraction** (e.g. ≥1 claim after parse).  
3. **Dedupe** by **normalised URL** or **input hash** *before* train/val/test split — never split duplicates across splits.

---

## 4) G1 — ToS mitigation (only after G0 passes)

**Empirical baseline:** run `pnpm ops:audit-ingest-extraction-models-neon` — see [technical review](./sophia-technical-review.md) §G.1.

| Path | Action |
|------|--------|
| **A — Regenerate labels** | Keep **inputs** (passages / `source_text_snapshot` / canonical corpus text). **Do not** use legacy extraction JSON as supervision. Produce new JSON with a **ToS-clear** labeler (Mistral API, self-hosted Apache-2 weights, DeepSeek MIT weights, etc.) — your separate vendor-policy note applies. |
| **B — Quarantine + greenfield** | Cut-over **run id** or **`completed_at`**; export only runs whose **`stage_models.extraction`** (or log replay) proves an **allowed** generator; manifest every shard with `{ source_id, label_model, label_date }`. |
| **C — Surreal-only** | **Invalid** for ToS — graph nodes are **derived from** the same API outputs. |

**Export hygiene:** every JSONL shard ships with a **sidecar manifest** (generator id, model string, date range, Neon run id range, Surreal `source` id list) so **pre-relabel** and **post-relabel** data never mix.

---

## 5) Safe work **while** ToS is under review

- **Done (2026-04-11):** archived outputs in **§8** (`ops:audit-ingest-training-volume` + `ops:audit-ingest-extraction-models-neon`, 90d and 365d — Neon window matched). Re-run after material ingest growth.  
- Finalise **dedupe** and **URL-normalisation** rules.  
- **Freeze extraction JSON schema** for the spike (technical review risk #9).  
- Shortlist **label generators** for counsel (their ToS, not only OpenAI’s).  
- Extend **Phase 0** timing / telemetry scripts if you need **larger windows** — see [`phase0-extraction-ingestion-baseline-report.md`](./phase0-extraction-ingestion-baseline-report.md).

**Avoid:** bulk copying `(text, production_json)` to “clean later” if **G1** may forbid using `production_json` as supervision — that is still **high-risk** handling of restricted data.

---

## 6) One-page checklist (spike kickoff)

- [x] **G0:** `pnpm ops:audit-ingest-training-volume` (90d default + optional `--days=365`) — recorded in **§8** (distinct URLs, staging coverage, Surreal counts).  
- [x] **G0 verdict:** **Red** on current Neon/Surreal scale — see **§8**; **stop** full fine-tune-on-mined-data spike until **N** grows or units are redefined and re-measured.  
- [x] **G1:** `pnpm ops:audit-ingest-extraction-models-neon` — merged model mix recorded in **§8**; attach to legal review.  
- [ ] **G1 verdict:** counsel sign-off **or** relabel plan **A**/**B** locked before any training export.  
- [x] **Surreal:** counts captured in **§8**; **no** training export without manifest rules in §4.  
- [ ] **ToS pipeline + relabel:** follow **§9** (Mistral extraction, fallbacks, Restormel routes, backfill existing imports).

---

## 7) References

| Doc / script | Role |
|--------------|------|
| [`sophia-technical-review.md`](./sophia-technical-review.md) | Risk 1, §G.1, dataset sizes, infra |
| [`phase0-extraction-ingestion-baseline-report.md`](./phase0-extraction-ingestion-baseline-report.md) | Wall-time baseline, `[INGEST_TIMING]` / telemetry |
| [`graph-rag-and-ingestion-architecture-overview.md`](../sophia/graph-rag-and-ingestion-architecture-overview.md) | Neon vs Surreal |
| `pnpm ops:audit-ingest-training-volume` | **G0** Neon (+ optional Surreal; `resolveSurrealRpcUrl` + `signinSurrealWithFallback`) |
| [`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md) | Env vars, SDK vs CLI, Cloud vs local |
| `pnpm ops:audit-ingest-extraction-models-neon` | **G1** extraction `provider/model` mix |
| `src/lib/ingestionCanonicalPipeline.ts` | Canonical extraction (Mistral-first for fine-tune path; see **§9**) |
| [`build-reingestion-manifest.ts`](../../scripts/build-reingestion-manifest.ts) | Rich reingestion manifest (local files + source lists + Surreal) |
| [`relabel-programme.ts`](../../scripts/relabel-programme.ts) | §9.5 inventory CSV/JSON, **`pnpm ops:relabel-sep-list`** (SEP-shaped Surreal rows + URL file), Neon URL→extraction map, training sidecar template |
| [`ingestion-relabel-runbook.md`](./ingestion-relabel-runbook.md) | §9.5 operator steps (backup, pilot, batch, audits) |

---

## 8) Measured snapshot (production — re-run commands to refresh)

**Captured:** **2026-04-11** (UTC), using `pnpm ops:audit-ingest-training-volume`, `pnpm ops:audit-ingest-extraction-models-neon`, and the same with `--days=365` (Neon counts **matched 90d vs 365d** — all instrumented completed history in range is within **90d**).

### G0 — volume (Neon + Surreal)

| Metric | 90d / 365d (Neon `completed_at`, `done`, not cancelled) |
|--------|-----------------------------------------------------------|
| Completed ingest runs | **71** |
| Distinct `source_url` (proxy training **units** before dedupe/quality) | **62** |
| Runs with `source_text_snapshot` ≥ 200 chars | **65** |
| Runs with ≥1 `ingest_staging_claims` row | **66** |
| Runs with `report_envelope.timingTelemetry` | **71** |
| Distinct URLs with **>1** run (dedupe pressure) | **8** |

**SurrealDB** (same instance as `.env.local`; all-time table counts):

| Metric | Value |
|--------|--------|
| `source` rows | **111** |
| `claim` rows | **18,640** |
| Distinct `source` with ≥1 claim (`GROUP BY source`) | **111** |

**G0 verdict (orientation §1):** **Red** — distinct Neon URLs (**62**) and even Surreal shipped sources (**111**) are **well below ~300** clean-pair floor from the technical review. **Treat full extraction fine-tune on mined production pairs as blocked on volume** until the corpus grows (or you explicitly redefine the unit of account, e.g. passage-level rows, and re-measure). **G1 / ToS** remains a **separate** blocker for using existing labels anyway (§4).

### G1 — extraction `provider/model` (90d = 365d in this snapshot)

**Merged per run** (envelope `stage_models.extraction`, else last `[INGEST_TIMING]` log):

| Route | Runs |
|-------|------|
| `openai/gpt-4o-mini` | **54** (~98%) |
| `anthropic/claude-opus-4-20250514` | **1** (~2%) |

**G1 status:** pending **your ToS confirmation** — empirically, production extraction labels are **not** from a policy-clear open labeler; plan **regenerate** or **quarantine** (§4) before any training export.

---

## 9) ToS-aligned ingestion — Mistral extraction + relabel programme

This section answers: **“Is storing `MISTRAL_API_KEY` and using credits enough?”** **No.** You also need **routing** (so the worker actually calls Mistral for **extraction**), **fallback hygiene** (so a retry does not silently fall back to OpenAI/Anthropic for the same stage), **operational proof** (`stage_models.extraction` + audits), **legal capture** of the **current** Mistral terms for your exact use (training / distillation), and — for anything already in Neon/Surreal — **regeneration** (re-run extraction on the **same source text**) if those rows must become training-eligible. **Flipping config does not rewrite history.**

**Validation** should stay on a **different** model than extraction (existing architecture already separates validation; keep it — see `CANONICAL_INGESTION_PRIMARY_MODELS` and [`sophia-technical-review.md`](./sophia-technical-review.md) product intent).

---

### 9.1 — Policy & evidence (before code freeze)

- [ ] **M9.1** — Download or paste into your spike folder the **current** Mistral **consumer / API** terms section that governs **use of outputs to train other models** (date-stamped URL or PDF). Same for any **second** labeler you might use for A/B.  
- [ ] **M9.2** — Write a **one-paragraph internal memo**: which **datasets** (Neon export, Surreal export, fine-tune JSONL) are allowed under those terms **after** relabel vs **quarantined forever**.  
- [ ] **M9.3** — Confirm **GCP / Cloud Run / worker** env will include `MISTRAL_API_KEY` (or BYOK path if keys live in Neon BYOK store) for **`scripts/ingest.ts`** workers — not only the SvelteKit app.

---

### 9.2 — Restormel Keys & routes (extraction workload)

Restormel resolves **`ingestion_extraction`** (and pins) to a published route; Sophia env can pin a route UUID.

- [ ] **M9.4** — In Restormel Keys, **create or select** a route whose **primary** (and, if you keep fallbacks, **every fallback tier** you allow for extraction) uses **Mistral** models you have quota for (e.g. **Large** / **Medium** class for hard JSON — align with catalog IDs in `@restormel/keys`).  
- [ ] **M9.5** — **Publish** the route; set `RESTORMEL_INGEST_EXTRACTION_ROUTE_ID` (or equivalent pin) in **staging**, run one **real** admin ingest, confirm logs show `mistral/...` in **`[INGEST_TIMING]`** `stage_models.extraction`.  
- [ ] **M9.6** — Repeat **M9.5** in **production** when satisfied; document the route id in runbooks.

---

### 9.3 — Codebase defaults & pins (canonical chain)

Canonical defaults live in **`src/lib/ingestionCanonicalPipeline.ts`** (`CANONICAL_INGESTION_PRIMARY_MODELS`, `CANONICAL_INGESTION_MODEL_FALLBACKS`). **Implemented:** extraction, relations, grouping, remediation, and json_repair default to **Mistral** with **Mistral-only** fallbacks; **validation** stays on **Vertex** with OpenAI/Vertex fallbacks. **`scripts/ingest.ts`** applies **`INGEST_FINETUNE_LABELER_STRICT`** (default on) + **`INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS`** so Restormel primaries, catalog routing JSON, or pins cannot reintroduce disallowed vendors on those stages without an explicit allowlist change.

- [ ] **M9.7** — **Short-term (recommended):** use env pins **`INGEST_PIN_PROVIDER_EXTRACTION`** / **`INGEST_PIN_MODEL_EXTRACTION`** (see `src/lib/server/ingestion/presetDiscipline.ts`) on workers **before** editing canonical defaults — proves routing without a full repo release.  
- [x] **M9.8** — **After pins validated:** update **`CANONICAL_INGESTION_PRIMARY_MODELS.extraction`** to Mistral and replace **`CANONICAL_INGESTION_MODEL_FALLBACKS.extraction`** with **Mistral-only** tiers (or remove OpenAI/Anthropic from **extraction** fallbacks entirely). Keep **validation** on a separate provider as today.  
- [x] **M9.9** — Update **tests** that assert OpenAI extraction defaults (`ingestRunIssues.test.ts`, catalog tests, etc.) so CI matches the new policy.  
- [ ] **M9.10** — Re-run **`pnpm ops:audit-ingest-extraction-models-neon`** after deploy; **§8** G1 table should move to **~100% `mistral/...`** for new runs.

---

### 9.4 — BYOK / Sophia app

- [ ] **M9.11** — If operators use **BYOK Mistral** in the dashboard, confirm the **same** key material (or server env) is available to **ingest workers**, not only browser-side flows.  
- [ ] **M9.12** — If keys are **server env only**, document rotation and which secret manager keys Cloud Run mounts.

---

### 9.5 — Relabel **existing** imports (Neon + Surreal)

**Goal:** for each **production `source`** that must be training-eligible, ensure **claims** (and downstream graph) were produced by **Mistral extraction** under the pinned route — not only “last ingest used Mistral for something else.”

**Operator runbook + automation:** [`ingestion-relabel-runbook.md`](./ingestion-relabel-runbook.md) · `pnpm ops:relabel-inventory` · `pnpm ops:relabel-neon-map` · `pnpm ops:relabel-sidecar`

- [x] **M9.13** — **Inventory:** `pnpm ops:relabel-inventory` → `data/relabel-inventory.json` + `.csv` (`source_id`, `url`, `canonical_url_hash`, `ingested_at`, …). Richer local/source-list join remains [`scripts/build-reingestion-manifest.ts`](../../scripts/build-reingestion-manifest.ts).  
- [x] **M9.14** — **Backup:** documented in **ingestion-relabel-runbook.md** §2 (Surreal snapshot / export before destructive relabel).  
- [x] **M9.15** — **Strategy documented** in [`ingestion-relabel-runbook.md`](./ingestion-relabel-runbook.md) §3: **A** — durable / fetch-first queue; **B** — **`ingest.ts`** (or **`replay-ingest.ts`**) with **`--force-stage extracting`** on existing **`data/sources/*.txt`** or Neon **`source_text_snapshot`** via **`INGEST_ORCHESTRATION_RUN_ID`**. **B** skips URL re-fetch when source text is already present; it still re-runs LLM stages from extraction through store.  
- [ ] **M9.16** — **Pilot:** 5–10 sources end-to-end; compare **claim count**, schema validity, and spot **faithfulness** vs pre-relabel snapshot — **execute in ops** (use `inventory --limit=10`).  
- [ ] **M9.17** — **Batch:** throttle concurrency (`ADMIN_INGEST_MAX_CONCURRENT`, job concurrency, `INGEST_JOB_LAUNCH_JITTER_MS`, Surreal write caps) — **execute in ops** (runbook §4).  
- [x] **M9.18** — **Post-batch audit:** `pnpm ops:audit-ingest-extraction-models-neon` + **`pnpm ops:relabel-neon-map`** (inventory URLs → latest done run `extraction_model` + summary counts).  
- [x] **M9.19** — **Training export manifest:** `pnpm ops:relabel-sidecar` → `data/training-relabel-sidecar.json` template (`source_id`, `canonical_url_hash`, `url`, `relabel_completed_at`, `extraction_model`); operators fill after each relabel wave.

---

### 9.6 — Quality, observability, rollback

- [ ] **M9.20** — Extend **Phase 0** doc or dashboards with **“% runs Mistral extraction”** SLO during rollout.  
- [ ] **M9.21** — **Rollback:** keep old Restormel route id + env pin values in a secure note; revert **`CANONICAL_*`** commit if needed.

---

### 9.7 — After rollout (G0 / G1)

- [ ] **M9.22** — Re-run **`pnpm ops:audit-ingest-training-volume`**; update **§8** — volume gate may still be **red** for fine-tune **size**, but **G1** for **new** labels should be **green** from a vendor mix perspective once relabel completes and counsel agrees.  
- [ ] **M9.23** — Only then start **training-data export** scripts; never mix pre-relabel shards with post-relabel shards in one fine-tune bucket.
