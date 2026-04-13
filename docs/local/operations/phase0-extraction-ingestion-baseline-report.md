# Phase 0 — Extraction spike prep (measurement & gates)

**Scope:** Baseline wall time, extraction sub-breakdown signals, quality gates, golden eval set proposal, hypotheses, and go/no-go. No model training or serving design.

**Production snapshot (Neon):** On **2026-04-13**, aggregates were recomputed from **`ingest_runs`** via read-only Drizzle (`pnpm ops:phase0-baseline-training-cohort -- --days=90`), using **`loadServerEnv()` + `DATABASE_URL`** (same pattern as `scripts/verify-neon-ingest-run.ts`). Window: **`completed_at` last 90 days**, `status = 'done'`, `cancelled_by_user = false`, `report_envelope` with **`timingTelemetry.stage_ms`**.

**Training-safe cohort (Phase 0 gate):** Statistics in **§1.4**, **§2.1**, **§6.1**, and **§6.2** are restricted to ingests that are **acceptable for model-training corpora**: `source_training_governance.exclude_from_model_training` is **not** set for the canonical URL hash **and** the same **`isTrainingModuleAcceptableLineage`** rules as `src/lib/server/metrics/datasetTopicPresetCoverage.ts` (verified `timingTelemetry.stage_models` for extraction / relations / grouping on approved providers, no `issueSummary.recovery_agent`, etc.). **Raw §1.2 SQL** does not apply this filter by itself — use the script or extend the SQL with governance join + envelope checks.

**Counts (90d, telemetry present):** **138** completed runs with `stage_ms`; **61** are **training-acceptable**; **all 61** have usable **`total_wall_ms`** in the envelope, so **N = 61** for fraction-of-E2E and the §6.1 wall table. **Only 3 / 61** runs used **`payload.validate === true`** (LLM validation path on the worker). The other **58** are still “safe” under **governance + lineage** rules but were **not** re-validated by a fixed judge model at ingest time — treat the corpus as **unvalidated for quality gates** until golden / batch validation and any **Gemini / Mistral–only** remediation pass completes (legal posture for downstream training).

**GCP Logging:** Optional `[INGEST_TELEMETRY]` / `[INGEST_TIMING]` sampling was **not** refreshed for this update. Operators may still use **§“Log queries”** to widen call-granularity evidence.

**Repro / refresh:** **`pnpm ops:phase0-baseline-training-cohort`** (`scripts/aggregate-phase0-baseline-training-cohort-neon.ts`) prints JSON (cohort sizes, stage percentiles, concentration, `ingest_run_issues` by kind). The **SQL in §1.2** remains the generic aggregate; add filters if you need a SQL-only replica of the training cohort.

---

## 1) Baseline wall time by stage (extraction first)

### 1.1 Where timing is recorded

| Mechanism | Location | What it captures |
|-----------|----------|-------------------|
| **`[INGEST_TIMING] {json}`** | `scripts/ingest.ts` — `logIngestTimingSummary()` prints one JSON line with full per-run telemetry | Final wall-clock payload: `stage_ms`, `total_wall_ms`, model/retry/repair counts, `stage_models`, etc. |
| **`[TIMING] phase: …`** | `scripts/ingest.ts` — `reportIngestPhaseTiming()` | Human-readable segment timing per phase; also mirrored to **`[INGEST_TELEMETRY]`** as `event: 'phase_timing'` |
| **Parse helper** | `src/lib/server/ingestRunIssues.ts` — `parseIngestTimingFromLogLines()` | Walks log lines **from the end**, returns the **last** object after `[INGEST_TIMING] ` |
| **Persisted report** | `persistIngestRunReport()` in same file → `neonSetReportEnvelope()` | Merges parsed object into `reportEnvelope.timingTelemetry` on `ingest_runs` (and Firestore-shaped mirror) |

**`[INGEST_TIMING]` payload shape** (interface `IngestTimingPayload` in `scripts/ingest.ts`):

- `stage_ms`: keys include **`extracting`**, `relating`, `grouping`, `embedding` (or `embed_wall_ms` overlap), `validating`, `remediating`, `storing`
- `total_wall_ms`: entire worker wall clock for the run
- `planning_initial_ms`, `planning_post_extraction_ms`, `planning_post_relations_ms`
- `model_calls`, `model_call_wall_ms` (per **stage** string, e.g. `extraction`)
- `model_retries`, `retry_backoff_ms_total`, `batch_splits`, `json_repair_invocations`
- `recovery_agent_invocations`, `recovery_agent_backoff_ms_total`
- `stage_models`: last successful `provider/model` per stage

**Extraction stage wall** is accumulated via `bumpStageMs('extracting', …)` when Stage 1 completes (`scripts/ingest.ts` around the extraction loop).

### 1.2 Preferred aggregation method (Neon SQL)

**Source of truth:** `ingest_runs.report_envelope` JSONB (populated on successful terminalization with the same structure as `buildIngestRunReportEnvelope` — field **`timingTelemetry`** holds the parsed `[INGEST_TIMING]` object).

`ingest_runs.source_type` and `ingest_runs.source_url` duplicate payload fields for indexing (`src/lib/server/db/schema.ts`).

**Completed runs:** `status = 'done'` and `completed_at` in the chosen window. Exclude user-cancelled runs: `cancelled_by_user = false`.

#### SQL — global stage percentiles (last 90 days)

Replace the interval as needed (`30 days`, `90 days`). **`planning_*` fields are siblings of `stage_ms` on `timingTelemetry`**, not inside `stage_ms` — the CTE below projects them from `ir.report_envelope` in one pass.

```sql
WITH m AS (
  SELECT
    ir.id,
    ir.source_type,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'extracting')::numeric, 0) AS extracting_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'relating')::numeric, 0) AS relating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'grouping')::numeric, 0) AS grouping_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'embedding')::numeric, 0) AS embedding_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'validating')::numeric, 0) AS validating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'remediating')::numeric, 0) AS remediating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'storing')::numeric, 0) AS storing_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'fetching')::numeric, 0) AS fetching_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_initial_ms')::numeric, 0)
      + COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_post_extraction_ms')::numeric, 0)
      + COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_post_relations_ms')::numeric, 0) AS planning_ms,
    NULLIF((ir.report_envelope->'timingTelemetry'->>'total_wall_ms')::numeric, 0) AS total_wall_ms
  FROM ingest_runs ir
  WHERE ir.status = 'done'
    AND ir.cancelled_by_user = false
    AND ir.completed_at IS NOT NULL
    AND ir.completed_at >= NOW() - INTERVAL '90 days'
    AND ir.report_envelope ? 'timingTelemetry'
    AND ir.report_envelope->'timingTelemetry' ? 'stage_ms'
),
s AS (
  SELECT
    *,
    extracting_ms / total_wall_ms AS frac_extract
  FROM m
  WHERE total_wall_ms IS NOT NULL
)
SELECT
  COUNT(*) AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p50_ms,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p90_ms,
  MAX(extracting_ms) AS extracting_max_ms,
  AVG(extracting_ms) AS extracting_mean_ms,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY frac_extract) AS frac_extract_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY frac_extract) AS frac_extract_p90,
  AVG(frac_extract) AS frac_extract_mean
FROM s;
```

**All stages + planning — p50 / p90 / max / mean (single result row):**

```sql
WITH m AS (
  SELECT
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'extracting')::numeric, 0) AS extracting_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'relating')::numeric, 0) AS relating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'grouping')::numeric, 0) AS grouping_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'embedding')::numeric, 0) AS embedding_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'validating')::numeric, 0) AS validating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'remediating')::numeric, 0) AS remediating_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'storing')::numeric, 0) AS storing_ms,
    COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_initial_ms')::numeric, 0)
      + COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_post_extraction_ms')::numeric, 0)
      + COALESCE((ir.report_envelope->'timingTelemetry'->>'planning_post_relations_ms')::numeric, 0) AS planning_ms,
    NULLIF((ir.report_envelope->'timingTelemetry'->>'total_wall_ms')::numeric, 0) AS total_wall_ms
  FROM ingest_runs ir
  WHERE ir.status = 'done'
    AND ir.cancelled_by_user = false
    AND ir.completed_at IS NOT NULL
    AND ir.completed_at >= NOW() - INTERVAL '90 days'
    AND ir.report_envelope ? 'timingTelemetry'
    AND ir.report_envelope->'timingTelemetry' ? 'stage_ms'
),
f AS (SELECT * FROM m WHERE total_wall_ms IS NOT NULL)
SELECT
  COUNT(*)::int AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p90,
  MAX(extracting_ms) AS extracting_max,
  AVG(extracting_ms) AS extracting_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY relating_ms) AS relating_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY relating_ms) AS relating_p90,
  MAX(relating_ms) AS relating_max,
  AVG(relating_ms) AS relating_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY grouping_ms) AS grouping_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY grouping_ms) AS grouping_p90,
  MAX(grouping_ms) AS grouping_max,
  AVG(grouping_ms) AS grouping_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY embedding_ms) AS embedding_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY embedding_ms) AS embedding_p90,
  MAX(embedding_ms) AS embedding_max,
  AVG(embedding_ms) AS embedding_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY validating_ms) AS validating_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY validating_ms) AS validating_p90,
  MAX(validating_ms) AS validating_max,
  AVG(validating_ms) AS validating_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY remediating_ms) AS remediating_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY remediating_ms) AS remediating_p90,
  MAX(remediating_ms) AS remediating_max,
  AVG(remediating_ms) AS remediating_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY storing_ms) AS storing_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY storing_ms) AS storing_p90,
  MAX(storing_ms) AS storing_max,
  AVG(storing_ms) AS storing_mean,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY planning_ms) AS planning_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY planning_ms) AS planning_p90,
  MAX(planning_ms) AS planning_max,
  AVG(planning_ms) AS planning_mean
FROM f;
```

**PostgreSQL note:** ordered-set aggregates (`percentile_cont` … `WITHIN GROUP`) **cannot** use a `FILTER` clause; restrict rows in a CTE (e.g. `f` above) instead.

#### SQL — by `source_type` (same window)

```sql
WITH m AS (
  /* same row projection as above */
  SELECT
    ir.source_type,
    COALESCE((ir.report_envelope->'timingTelemetry'->'stage_ms'->>'extracting')::numeric, 0) AS extracting_ms,
    NULLIF((ir.report_envelope->'timingTelemetry'->>'total_wall_ms')::numeric, 0) AS total_wall_ms
  FROM ingest_runs ir
  WHERE ir.status = 'done'
    AND ir.cancelled_by_user = false
    AND ir.completed_at IS NOT NULL
    AND ir.completed_at >= NOW() - INTERVAL '90 days'
    AND ir.report_envelope ? 'timingTelemetry'
    AND ir.report_envelope->'timingTelemetry' ? 'stage_ms'
),
f AS (SELECT * FROM m WHERE total_wall_ms IS NOT NULL)
SELECT
  source_type,
  COUNT(*)::int AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p50_ms,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extracting_ms) AS extracting_p90_ms,
  AVG(extracting_ms / total_wall_ms) AS mean_frac_extract
FROM f
GROUP BY 1
ORDER BY n DESC;
```

**Alternative if `report_envelope` is sparse:** parse the last `ingest_run_logs.line` matching `'[INGEST_TIMING] %'` per run (same predicate as `neonListIdleStalledIngestCandidateRows` in `src/lib/server/db/ingestRunRepository.ts`).

### 1.3 Fallback — GCP Cloud Logging (no Neon)

Export or query logs where `textPayload` / `jsonPayload.message` contains `[INGEST_TIMING]`. Extract JSON after the prefix (same as `parseIngestTimingFromLogLines`).

**Log-based metric / Saved query concept:** filter `logName` to the ingest worker service; regex `\[INGEST_TIMING\] (\{.*\})` then parse JSON.

### 1.4 Answer: % of total wall time in `extracting` (mean + p90)

**Training-acceptable cohort**, **N = 61** runs with **`total_wall_ms`** (2026-04-13, `pnpm ops:phase0-baseline-training-cohort`):

- **`frac_extract_mean` ≈ 0.2605** → **Mean % extraction of E2E ≈ 26.1%**
- **`frac_extract_p90` ≈ 0.4328** → **p90 % extraction of E2E (per-run share) ≈ 43.3%**

Re-run formulas: **Mean %** = `100 * frac_extract_mean`, **p90 %** = `100 * frac_extract_p90`.

**Implication:** Extraction is still **~¼–¼+ of E2E on average** with a **material tail** (~43% of wall at **p90** of per-run shares), but it is **not** half of every run. A **perfect** zero-cost extraction (else unchanged) caps **mean** E2E savings near **~26%**; realistic fine-tunes recover **a fraction** of that, so **extraction-only** tuning **cannot** deliver a **~50% full-run** speedup **by itself** unless **grouping**, **storing**, **relating**, and occasional **validation / remediation** tails also move — see **§7**.

**Same cohort — arithmetic mean of `stage_ms` buckets (not the same as mean of per-run fractions):** **grouping** and **storing** have the **largest mean** wall (~395s and ~302s), then **extracting** (~264s) and **relating** (~129s). **Median** **`validating`** / **`remediating`** wall is **small** (p50 ~1.4s / ~0) with **large max tails** (single runs up to **~473s** validating, **~796s** remediating), so a **few** runs still spend heavily after extraction.

**Caveat:** `total_wall_ms` is process wall clock from `run_started_at_ms` to summary; it includes planning and any gaps **not** attributed to a `stage_ms` bucket. Runs that fail lineage / governance filters are **excluded** from **N = 61** but still matter for operator throughput — see the script’s `cohort.doneWithStageMsTelemetry` (**138**) vs **61**.

### 1.5 LLM token totals and per-stage tokens (`[INGEST_TIMING]` → Neon)

**From worker changes (post–this doc update):** each completed run’s `[INGEST_TIMING]` JSON includes:

| Field | Meaning |
|--------|--------|
| `total_input_tokens` | Sum of provider-reported **input** tokens on every `generateText` call in the run |
| `total_output_tokens` | Sum of **output** tokens on those calls |
| `stage_input_tokens` | Map keyed by pipeline stage string (`extraction`, `relations`, `grouping`, `validation`, `remediation`, `json_repair`, …) |
| `stage_output_tokens` | Same, for output tokens |
| `vertex_embed_chars` | Characters passed to Vertex embedding (`trackEmbeddingCost`); **not** LLM tokens |

Older envelopes lack these keys — treat null as **0** / missing in SQL.

**Aggregate mean / p90 per run (90-day `done` runs with telemetry):**

```sql
WITH m AS (
  SELECT
    NULLIF((ir.report_envelope->'timingTelemetry'->>'total_input_tokens')::bigint, 0) AS total_in,
    NULLIF((ir.report_envelope->'timingTelemetry'->>'total_output_tokens')::bigint, 0) AS total_out
  FROM ingest_runs ir
  WHERE ir.status = 'done'
    AND ir.cancelled_by_user = false
    AND ir.completed_at >= NOW() - INTERVAL '90 days'
    AND ir.report_envelope ? 'timingTelemetry'
)
SELECT
  COUNT(*) FILTER (WHERE total_in IS NOT NULL OR total_out IS NOT NULL) AS n_with_tokens,
  AVG(total_in) FILTER (WHERE total_in IS NOT NULL) AS mean_input_tokens,
  AVG(total_out) FILTER (WHERE total_out IS NOT NULL) AS mean_output_tokens,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY total_in) FILTER (WHERE total_in IS NOT NULL) AS p50_input,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY total_in) FILTER (WHERE total_in IS NOT NULL) AS p90_input,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY total_out) FILTER (WHERE total_out IS NOT NULL) AS p50_output,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY total_out) FILTER (WHERE total_out IS NOT NULL) AS p90_output
FROM m;
```

**Per-stage share of LLM input tokens (single run or averaged in application code):** read `timingTelemetry->'stage_input_tokens'` as JSON object; divide each value by `NULLIF(total_input_tokens,0)` for **fraction of prompt tokens** attributed to that stage (same for output using `stage_output_tokens` / `total_output_tokens`).

**Extrapolating ~500 more SEP entries (same pins / preset as baseline cohort):**

1. Restrict the CTE to `source_type = 'sep_entry'` (and optional URL pattern `source_url LIKE '%plato.stanford.edu/entries/%'`).
2. Let **μ** = `AVG(total_input_tokens + total_output_tokens)` (or separate means if you price in/out differently).
3. **Point estimate:** `500 * μ` total tokens; **p90-style budget:** `500 * (p90_input + p90_output)` from the per-run distribution if you need headroom for tail articles.
4. **Calibration:** multiply by **`claims_extracted` ratio** if new entries are systematically longer (e.g. sample mean claims per SEP run from Surreal `ingestion_log` or Neon staging if mirrored) — token use scales roughly with batches and claim count, not only URL count.
5. **Embedding:** add `500 * AVG(vertex_embed_chars)` from the same timing JSON if present; bill as chars ÷ 1M × model rate, not as LLM tokens.

**Historical runs without new fields:** sum `[INGEST_TELEMETRY]` `model_call_end` lines in `ingest_run_logs` (`input_tokens`, `output_tokens`, `stage`) or GCP Logging export — heavier than reading `report_envelope`.

---

## 2) Where extraction time goes (sub-breakdown)

### 2.1 Few long calls vs many medium calls

| Signal | Field / pattern | Interpretation |
|--------|-----------------|----------------|
| **Calls per stage** | `[INGEST_TIMING].model_calls.extraction` (number) | High count with moderate `model_call_wall_ms.extraction` → many medium calls |
| **Wall per call (derived)** | `model_call_wall_ms.extraction / max(1, model_calls.extraction)` | Large → fewer, longer calls dominating |
| **Per-call spans in logs** | `[INGEST_TELEMETRY]` with `event: model_call_end`, `stage: extraction`, `duration_ms` | Distribution / max single-call duration per run |

Telemetry emission: `scripts/ingest.ts` in `callStageModel` → `emitIngestTelemetry({ event: 'model_call_start' | 'model_call_end', stage, duration_ms, input_tokens, output_tokens })` (`src/lib/server/ingestion/ingestionTelemetry.ts` prefixes `[INGEST_TELEMETRY]`).

**SQL (per-run extraction concentration)** — after fixing CTE to use `report_envelope` only:

```sql
SELECT
  ir.id,
  ir.source_url,
  (ir.report_envelope->'timingTelemetry'->'model_calls'->>'extraction')::int AS extraction_calls,
  (ir.report_envelope->'timingTelemetry'->'model_call_wall_ms'->>'extraction')::numeric AS extraction_call_wall_ms
FROM ingest_runs ir
WHERE ir.status = 'done'
  AND ir.completed_at >= NOW() - INTERVAL '90 days'
  AND ir.report_envelope->'timingTelemetry'->'model_calls' ? 'extraction';
```

**Production read (2026-04-13, Neon, training-acceptable cohort):** On **N = 61** runs with **`model_calls.extraction`** and **`model_call_wall_ms.extraction`**, **Pearson corr(`extracting_ms`, `model_call_wall_ms.extraction`) ≈ 0.99** — extraction segment wall time tracks extraction-stage model wall time almost one-to-one, consistent with **model latency / call count** driving **`stage_ms.extracting`**.

**Call shape:** **median 4** extraction calls per run (**p90 6**); **median implied ms/call** (`model_call_wall_ms.extraction / calls`) **≈ 57.5k** (**p90 ≈ 90.8k**). Pattern: **moderate call count** with **heavy per-call wall**, not hundreds of tiny calls.

**`timingTelemetry` counters (same 61 runs):** `batch_splits` **p50 / p90 = 0**; `recovery_agent_invocations` **p50 / p90 = 0**; `json_repair_invocations` **median 1**, **p90 3**; `model_retries` **p50 / p90 = 0**. **`ingest_run_issues` summed over those 61 runs** (all kinds returned by the script): e.g. **`json_repair` 180**, **`batch_split` 216**, **`truncation` 61**, **`ingest_retry` 4**, **`grouping_integrity` 25**, **`warning` 29**, **`resume_checkpoint` 17** — **repair-ish kinds** (`json_repair`, `ingest_retry`, …) **≈ 184** row-events in aggregate. So **JSON repair / truncation pressure** remains visible in **issues** as well as in **`json_repair_invocations`** telemetry (not “zero repair” — rather **low batch_splits** in timing vs **many `batch_split` / `json_repair` issue rows**).

### 2.2 Correlation: tokens, batch splits, retries, recovery agent, concurrency

| Factor | Evidence in repo |
|--------|------------------|
| **Token counts** | Each `model_call_end` includes `input_tokens`, `output_tokens`. Aggregate in BigQuery/Log Analytics or export. |
| **Batch splits** | `[INGEST_TIMING].batch_splits`; log lines `[SPLIT] Batch … truncated` / repair truncation (`scripts/ingest.ts` extraction loop) |
| **Retries** | `[INGEST_TIMING].model_retries`, `retry_backoff_ms_total`; console `[RETRY] ${stage}` |
| **Recovery agent** | `[INGEST_TIMING].recovery_agent_invocations`, `recovery_agent_backoff_ms_total`; structured `formatIngestSelfHealLine` with `signal: recovery_agent` (also `ingest_run_issues.kind = 'recovery_agent'`) |
| **Parallel extraction** | Env `INGEST_EXTRACTION_CONCURRENCY` (default **3** in code); log `[PARALLEL] Extracting N single-passage batches concurrently (max K)` |

**Concurrency note:** Parallelism applies when **multiple single-passage batches** are grouped; it changes whether wall time is dominated by **critical path** of the slowest parallel group vs sum of sequential calls.

---

## 3) Quality definition (“no regression” gates)

All gates assume **pinned validation** (and optionally extraction) models for comparability — see `docs/operations/ingestion-golden-sep-corpus.md` and `timingTelemetry.stage_models.validation`.

**Product rule (post–Phase 0):** Keep **validation on a separate, fixed “judge” model** (not the same fine-tuned worker used for extract / relate / group / remediate / JSON repair). That preserves **faithfulness measurement** as a stable control arm: upstream stages should get faster and cleaner so validation **passes** with less rework, not because the judge co-adapted with tuned weights.

| Gate | Metric | Where it is recorded | Suggested threshold (tune from baseline) |
|------|--------|----------------------|----------------------------------------|
| **First-pass JSON / schema validity** | Fraction of extraction batches that succeed **without** going through `fixJsonWithModel` / json-repair path | **Before repair:** absence of `[WARN] JSON parse/validation failed` for that batch is implicit in logs; **aggregate:** `json_repair_invocations` in `[INGEST_TIMING]` counts repair model invocations (not identical to “batches failed JSON” but strongly correlated). **`ingest_run_issues`** rows with `kind = 'json_repair'` (`src/lib/server/ingestRunIssues.ts`) | **Baseline mean + 3σ** or **≤ baseline p90** on `json_repair_invocations` per run for golden URLs; optional: count `json_repair` issues / extraction batch count from logs |
| **Schema validity post-parse** | `ExtractionOutputSchema.parse` success rate | Failed runs throw / log; issue `kind = 'parse_or_schema'` | **Zero** new hard failures on golden set compared to baseline |
| **Faithfulness (validation on)** | Per-claim `faithfulness_score` (0–100); run-level average logged as `Average faithfulness score` (`scripts/ingest.ts`) | Logs; optional Surreal `validation_score` on claims at store time | **Mean faithfulness** ≥ baseline mean − **2** points; **p10** claim score not worse than baseline − **5** on same URLs |
| **Relation integrity** | `assertRelationIntegrity` — no missing endpoints | Hard error `[INTEGRITY] … relations reference missing claim positions` | **0** integrity violations on golden runs |
| **Remediation pressure** | Relations dropped in remediation: `[REMEDIATION] Dropped N relation edge(s)`; `remediating` `stage_ms` | Logs + `stage_ms.remediating` | **≤ baseline** mean `remediating_ms` and dropped-edge count on golden set |
| **Quarantine** | Post-store audit: `[POST_STORE_AUDIT]` low faithfulness → admin quarantine (`scripts/ingest.ts`) | Logs; API `GET /api/admin/quarantine/queue` | **≤ baseline** quarantine count per golden batch |
| **Operator sanity — retries / recovery** | `model_retries`, `recovery_agent_invocations` | `[INGEST_TIMING]`; issues `kind IN ('retry','recovery_agent')` | **≤ max(baseline p90 × 1.25, baseline + 2)** per run on golden URLs |

**Exact log patterns (non-exhaustive):**

- `[OK] Extracted N claims from batch` vs `[OK] Fixed and extracted` → repair path used
- `[SPLIT] Batch` → truncation-driven batching
- `[RETRY] extraction`, `[RECOVERY_AGENT] extraction`
- `Average faithfulness score: X/100`
- `[INTEGRITY]`, `[REMEDIATION]`, `[POST_STORE_AUDIT]`

---

## 4) Golden evaluation set (30–50 URLs)

**Criteria:** Mix of **SEP** (bulk of production), **long / dense** entries, **non-Western / feminist / philosophy of science**, **formal** (logic, set theory), plus **web_article** slots filled from real successful non-SEP ingests in Neon.

**Storage:** `docs/local/operations/golden-extraction-eval.json` (machine-readable list + SQL hint for `web_article` rows).

**Runbook:** Re-ingest each URL with **`--validate`** (or admin payload `validate: true`), same pins (`INGEST_PIN_*`, optional `INGEST_NO_MODEL_FALLBACK=1`), capture `[INGEST_TIMING]` + faithfulness summary + issue counts.

### 4.1 Frozen list (40 SEP + operator `web_article` tail)

All rows below are **`sep_entry`** unless noted. Add **5–10** `web_article` URLs from production (see `web_article_placeholders` in the JSON file).

| url | source_type | why |
|-----|---------------|-----|
| https://plato.stanford.edu/entries/plato/ | sep_entry | Core canon; medium-long; dense dialogue citations — stable sectioning / grounding. |
| https://plato.stanford.edu/entries/aristotle/ | sep_entry | Very large hub; many internal links — stress long-context batching. |
| https://plato.stanford.edu/entries/kant/ | sep_entry | Layered arguments; heavy terminology — schema + later relation endpoints. |
| https://plato.stanford.edu/entries/frege/ | sep_entry | Formal philosophy; notation — object/meta-language conflation risk. |
| https://plato.stanford.edu/entries/wittgenstein/ | sep_entry | Interpretive spread; long bibliography — span fidelity. |
| https://plato.stanford.edu/entries/hegel/ | sep_entry | Dense systematic prose — summarization bias. |
| https://plato.stanford.edu/entries/spinoza/ | sep_entry | Definitions-style passages — definitional vs interpretive claims. |
| https://plato.stanford.edu/entries/descartes/ | sep_entry | Clear argument structure — faithfulness baseline. |
| https://plato.stanford.edu/entries/hume/ | sep_entry | Long; empiricism vs normativity — mixed claim types. |
| https://plato.stanford.edu/entries/locke/ | sep_entry | Political + metaphysical threads — cross-domain in one source. |
| https://plato.stanford.edu/entries/leibniz/ | sep_entry | Metaphysics + logic crossover — formal vocabulary density. |
| https://plato.stanford.edu/entries/berkeley/ | sep_entry | Idealism; counterintuitive theses — hallucination risk on summaries. |
| https://plato.stanford.edu/entries/mill/ | sep_entry | Utilitarianism hub; policy-flavored claims — confidence calibration. |
| https://plato.stanford.edu/entries/rawls/ | sep_entry | Structured principles — downstream grouping/validation stress. |
| https://plato.stanford.edu/entries/nietzsche/ | sep_entry | Rhetorical / aphoristic — non-literal extraction risk. |
| https://plato.stanford.edu/entries/existentialism/ | sep_entry | Survey; multiple authors — attribution disambiguation. |
| https://plato.stanford.edu/entries/aquinas/ | sep_entry | Medieval theology + philosophy — domain tagging. |
| https://plato.stanford.edu/entries/medieval-philosophy/ | sep_entry | Broad survey; many proper names — entity-heavy text. |
| https://plato.stanford.edu/entries/set-theory/ | sep_entry | Formal math; axioms — JSON + symbol-heavy passages. |
| https://plato.stanford.edu/entries/aristotle-logic/ | sep_entry | Technical logic history — long dense paragraphs. |
| https://plato.stanford.edu/entries/consciousness/ | sep_entry | PoMind hub; empirical cites — science-philosophy boundary. |
| https://plato.stanford.edu/entries/physicalism/ | sep_entry | Analytic metaphysics of mind — fine-grained distinctions. |
| https://plato.stanford.edu/entries/dualism/ | sep_entry | Objections/replies — relation graph stress in later stages. |
| https://plato.stanford.edu/entries/meaning/ | sep_entry | Philosophy of language — polysemy and quotation. |
| https://plato.stanford.edu/entries/truth/ | sep_entry | Theories of truth — validation sensitivity. |
| https://plato.stanford.edu/entries/time/ | sep_entry | Metaphysics + physics crossover — long chains. |
| https://plato.stanford.edu/entries/justice/ | sep_entry | Normative political concepts — evaluative language. |
| https://plato.stanford.edu/entries/race/ | sep_entry | Social philosophy; sensitive claims — review + faithfulness. |
| https://plato.stanford.edu/entries/feminist-philosophy/ | sep_entry | Interdisciplinary — citation-heavy sections. |
| https://plato.stanford.edu/entries/buddhism-huayan/ | sep_entry | Non-Western metaphysics — unfamiliar lexicon. |
| https://plato.stanford.edu/entries/chinese-metaphysics/ | sep_entry | Comparative / classical references — alignment difficulty. |
| https://plato.stanford.edu/entries/evolution/ | sep_entry | Philosophy of biology — science-heavy prose. |
| https://plato.stanford.edu/entries/biology-philosophy/ | sep_entry | Detailed scientific examples — long evidence passages. |
| https://plato.stanford.edu/entries/quantum-field-theory/ | sep_entry | Heavy formalism — truncation / batch_split failure mode. |
| https://plato.stanford.edu/entries/scientific-realism/ | sep_entry | Dense debate — undercutting objections. |
| https://plato.stanford.edu/entries/artificial-intelligence/ | sep_entry | AI ethics + CS — vocabulary / cutoff drift. |
| https://plato.stanford.edu/entries/computer-science/ | sep_entry | Philosophy of CS — structured HTML lists. |
| https://plato.stanford.edu/entries/information/ | sep_entry | Abstract vs concrete information — subtle definitions. |
| https://plato.stanford.edu/entries/reference/ | sep_entry | Self-referential examples — span edge cases. |
| https://plato.stanford.edu/entries/schopenhauer/ | sep_entry | Systematic aesthetics + metaphysics — long compounds. |
| https://plato.stanford.edu/entries/locke-personal-identity/ | sep_entry | Focused deep dive — shorter entry pathologies. |
| *(add from Neon)* | web_article | Long-tail HTML / paywall-free institutional pages already ingested with `validate: true`. |

---

## 5) Extraction-specific hypotheses (ranked)

1. **Multi-stage wall after extraction (training cohort)** — On **N = 61** training-acceptable runs, **mean per-run `extracting` / `total_wall_ms` ≈ 26%** (§1.4). **Arithmetic means of `stage_ms`** show **grouping** and **storing** with the **largest mean** wall, then **extracting**, then **relating**; **validating** / **remediating** are **small at median** but have **heavy tails**. A bespoke extractor helps **mean E2E** only in proportion to that **~26%** share unless it **reduces downstream work** (fewer claims/edges to group, fewer store retries, less remediation).
2. **Model latency still shapes extraction** — **Corr(extracting, `model_call_wall_ms.extraction`) ≈ 0.99** (§2.1), **~4–6** calls/run at median/p90, **~58–91s per call** median/p90 — **fewer, longer calls** dominate extraction wall more than “dozens of micro-calls”.
3. **JSON repair / truncation** — **`json_repair_invocations`** are **non-zero** at median (**1**) and **p90 (3)** on the training cohort; **`ingest_run_issues`** still log **`json_repair`** (**180** rows) and **`batch_split`** (**216**) across the same 61 runs — **format / chunk pressure** is real and should be tracked on **golden re-runs**, not dismissed as “missing telemetry.”

*(Re-ranked after training-cohort Neon baseline, 2026-04-13.)*

**Spike framing:** **Mean extraction share ~26%** (§1.4) keeps the **multi-stage reuse** story in **§7** as the right container for a **~50% E2E** ambition — not extraction-only ROI in isolation.

---

## 6) Deliverables checklist

- [x] Table: **stage** × **p50 / p90 / max / mean** wall ms + sample **N** — §6.1 *(training-acceptable cohort, **N = 61**, 2026-04-13; `pnpm ops:phase0-baseline-training-cohort`)*.
- [x] Paragraph: **% of E2E** in extraction (mean + p90) — §6.2 *(**~26.1%** mean, **~43.3%** p90)*.
- [x] **Quality gates** with thresholds + **separate validation model** rule — §3.
- [x] **Golden set** + storage path — §4 / `docs/local/operations/golden-extraction-eval.json`.
- [x] **Go / no-go** + **portfolio / multi-phase** framing — §6.5 and **§7**.

### 6.1 Table — stage × p50 / p90 / max / mean wall ms (sample N)

**N = 61** — **training-acceptable** completed ingests, last **90 days**, `timingTelemetry.stage_ms` present **and** `total_wall_ms` non-null. Values rounded to nearest ms except planning (sub-second).

| stage (`stage_ms` or planning sum) | p50 ms | p90 ms | max ms | mean ms |
|------------------------------------|--------|--------|--------|---------|
| extracting | 241,325 | 412,735 | 618,402 | 264,196 |
| relating | 59,828 | 287,202 | 486,817 | 129,043 |
| grouping | 233,826 | 878,981 | 2,066,668 | 394,807 |
| embedding | 2,689 | 3,741 | 8,498 | 2,879 |
| validating | 1,392 | 3,162 | 472,761 | 21,609 |
| remediating | 0 | 1 | 795,538 | 25,075 |
| storing | 248,836 | 516,289 | 912,573 | 301,727 |
| planning | 5 | 7 | 7 | 5 |

Source: **`pnpm ops:phase0-baseline-training-cohort`** (same projection as §1.2 “all stages + planning” on the filtered cohort).

**By `source_type`:** all **61** rows are **`sep_entry`** in this snapshot (`by_source_type_training_acceptable` from the script).

### 6.2 Paragraph — % of E2E in extraction (mean + p90)

Over the last **90 days**, among **N = 61** **training-acceptable** completed ingests with usable `total_wall_ms`, **`extracting` accounted for ~26.1%** of `total_wall_ms` **on average** and **~43.3%** at the **p90 of per-run fractions** (`frac_extract_mean` ≈ **0.2605**, `frac_extract_p90` ≈ **0.4328**). **Validation coverage:** only **3** of those **61** runs had **`payload.validate === true`** — the Phase 0 **throughput / wall-time** baseline is grounded in **governance + lineage–safe** data, but **not** in a fully **LLM-validated** training corpus. **Refresh:** `pnpm ops:phase0-baseline-training-cohort` (or extend §1.2 SQL with the same filters).

### 6.3 Quality gates (summary)

See §3 — numeric thresholds should be **derived from one baseline golden batch** once `[INGEST_TIMING]` + validation logs are frozen.

### 6.4 Golden set + storage path

- **Path:** `docs/local/operations/golden-extraction-eval.json`
- **Contents:** 40 curated SEP URLs + rationale fields; operators should append **5–10** `web_article` URLs from Neon (`SELECT source_url, … FROM ingest_runs WHERE source_type = 'web_article' AND status = 'done' …`).

### 6.5 Go / no-go (one paragraph)

**No-go** on treating **bespoke extraction alone** as the lever that delivers **~50% full-run** improvement: on the **training-acceptable N = 61** cohort, **mean** `extracting` / `total_wall_ms` is **~26%** — still **below** a **~35–40%** “large mean share” gate for extraction-centric ROI — while **grouping** and **storing** (and **relating**) carry **large mean `stage_ms`** in the same window. **Extraction remains material at the tail** (**~43%** of E2E at **p90** of per-run shares), and **corr(extracting, `model_call_wall_ms.extraction`) ≈ 0.99** supports tuning **extraction model speed / batching** where the worker is bound by **few, long** calls (§2.1).

**Do go** on a **platform** bet (see **§7**): prove a **worker** (fine-tuned or bespoke) on **extraction first**, then **reuse** the same model or adapter family on **relating, grouping, remediation, and JSON repair** — **always** keep **validation on a separate fixed “judge” model** (§3), and plan a **Gemini / Mistral–only** **remediation + re-validation** pass before any **training** use so the corpus is both **lineage-safe** and **quality-verified**. Do **not** expect **~50% E2E** from extraction in isolation; treat **~50%** as a **portfolio** target, with **moderated first-wave** expectations (e.g. **10–20%** full-run if several stages improve), then reassess.

**Hardening before training:** **58 / 61** training-acceptable runs in this snapshot **did not** run with **`validate: true`** on ingest — Phase 0 is **not** “all training data validated” yet; complete **golden + batch validation**, then **remediate** under approved providers only.

---

## 7) Strategy: 50% E2E vs extraction-only fine-tune (handover narrative)

This section captures the **product / research synthesis** (including the follow-up chat you had after Neon baselines). Numbers cited for **mean vs p90 extraction share** refer to the **training-acceptable N = 61** cohort in §1.4 / §6.2 (2026-04-13). Widen **call-granularity** evidence with GCP exports if needed.

| Topic | Implication |
|--------|-------------|
| **“50% from extraction-only fine-tune”** | **Wrong lever** for a **50% end-to-end** goal when **mean** extraction is **~¼–¼+** of `total_wall_ms` (**~26%** here): even a **free** extraction stage caps **mean** E2E savings near that share; realistic fine-tunes recover **a fraction** of that. |
| **Reuse across relate / group / remediate / fix** | **Plausible path** to a larger **run-level** win: a domain-specialised worker that is **faster**, **more format-stable**, or **cheaper per token** can **compound** across structured-output stages and **json_repair**-heavy paths — same fine-tune or **same family + adapter** as a platform bet. |
| **Validation always separate** | Keep a **strong, fixed alternative model** for validation (pins + no co-training with the worker). Quality gates stay interpretable; faster runs should come from **cleaner upstream outputs**, not a weaker judge. |
| **Success criteria** | **Layered:** per-stage latency, tokens, repair rate, retries (`[INGEST_TIMING]`, `[INGEST_TELEMETRY]`); **run-level** `total_wall_ms`. First fine-tune wave: target **moderated** full-run improvement (order **10–20%** if multiple stages move), then iterate; **~50%** remains an **ambition** across the **whole** portfolio (model + concurrency + retries + embed/store), not extraction in isolation. |

---

## File paths referenced

| Path | Role |
|------|------|
| `scripts/aggregate-phase0-baseline-training-cohort-neon.ts` | Training-cohort JSON aggregates (`pnpm ops:phase0-baseline-training-cohort`) |
| `scripts/ingest.ts` | `[INGEST_TIMING]`, `[TIMING]`, `IngestTimingPayload`, extraction loop, faithfulness logs |
| `src/lib/server/ingestion/ingestionTelemetry.ts` | `[INGEST_TELEMETRY]` prefix and heartbeat |
| `src/lib/server/ingestRunIssues.ts` | `parseIngestTimingFromLogLines`, report envelope shape |
| `src/lib/server/db/schema.ts` | `ingest_runs`, `ingest_run_logs`, `ingest_run_issues`, `report_envelope` |
| `src/lib/server/db/ingestRunRepository.ts` | `neonSetReportEnvelope`, timing line subquery |
| `docs/operations/gcp-ingest-worker.md` | Logging / watchdog context |
| `docs/operations/ingestion-golden-sep-corpus.md` | Pins + comparability for validation |

---

## 8) Neon ingest cost & token baseline (operator snapshot)

**Purpose:** Ground **initial ingestion spend** and **Mistral credit sizing** in what Neon already recorded on completed runs (envelope `ingest_staging_meta.cost_usd_snapshot` + `timingTelemetry`), not only in live log exports.

**As of:** 2026-04-12 (America/Toronto).

**Reproduce:**

```bash
pnpm ops:audit-ingest-cost-by-phase-neon -- --days=365
```

**Cohort:** `ingest_runs` with `status = 'done'`, `cancelled_by_user = false`, `completed_at` within the last **365 days**.

| Metric | Value |
| --- | --- |
| Completed runs | 73 |
| Runs with `report_envelope` | 73 |
| Runs with `timingTelemetry` **and** `ingest_staging_meta.cost_usd_snapshot` | **67** |
| **Σ `cost_usd_snapshot` (USD)** over those 67 runs | **~16.20** |
| Implied mean per run (67) | **~0.24** |

**Interpretation:** `cost_usd_snapshot` is the **operator-facing USD estimate** written at ingest completion (same family of numbers as the per-run “Cost (est.)” line in admin). It is the most reliable **historical total** in Neon for “how much have these runs cost in our model,” even when per-call catalog re-pricing is incomplete.

**Catalog/token re-estimate (same audit):** Restormel pricing table + **$0.025 / M embed chars** over the same telemetry cohort yields **~0.50 USD** total. That line **understates** real Vertex/Gemini spend when those SKUs are missing from the catalog (same caveat as live `[INGEST_TIMING]` cost lines).

**Per-stage LLM tokens** (`timingTelemetry.stage_input_tokens` / `stage_output_tokens`, summed over the **67** runs that had `timingTelemetry` — same cohort as the snapshot sum):

| Stage | Input tokens (sum) | Output tokens (sum) |
| --- | --- | --- |
| extraction | 27,391 | 49,876 |
| relations | 128,812 | 49,680 |
| grouping | 99,046 | 4,193 |
| json_repair | 3,095 | 2,057 |
| **All stages** | **258,344** | **105,806** |

**`modelChain`:** Among runs where the field is present in the envelope (**64** for extract in this audit), **63** use **`auto`** for extract / relate / group; **one** historical run used explicit OpenAI (`gpt-4o-mini` on extract, `gpt-4-turbo` on relate/group). A few telemetry rows omit `modelChain` entirely.

**`stage_models` (frequency, telemetry cohort):** extraction is still mostly **`openai/gpt-4o-mini`** on older rows; newer rows show **`mistral/mistral-medium-latest`** and **`vertex/gemini-*`** mixed in. Relations/grouping skew OpenAI historically; **validation / remediation / json_repair** skew **Vertex** — so **Mistral credit** for a **full** pipeline is not the whole story unless you move **all** LLM stages to Mistral.

**Wall time (sum of `stage_ms` over the telemetry cohort, for context only):** extracting ~4.31 h, relating ~0.40 h, grouping ~0.31 h, embedding ~0.03 h, validating ~2.41 h, remediating ~1.38 h, storing ~2.53 h (**Σ ~11.37 h**). Mean `total_wall_ms` where non-zero: **~769,923 ms** over **18** runs (many envelopes omit `total_wall_ms`).

**Mistral credit (practical):**

1. **Anchor on `cost_usd_snapshot` totals** for “what we have already spent per run / in aggregate,” then add margin for new sources and model drift.
2. **Single large PDF philosophy run** (example from a recent envelope): **~0.45–0.50 USD** in snapshot for one ~1.1k-chunk source — use that as an **order-of-magnitude upper-ish** for dense PDFs when extraction is the main cost.
3. **Batch of tens of sources** at ~0.24 mean snapshot per completed run suggests **on the order of tens of USD** for the year’s completed ingest cohort (67 runs with snapshots) — scale linearly with **N sources** and **chunk count**, not with log export coverage.

---

## Log queries (GCP Logging — examples)

### Authenticate (`gcloud` browser login)

Run in **your own terminal** (must allow opening a browser or pasting a verification URL):

```bash
gcloud auth login
```

If the CLI still cannot refresh tokens (CI / headless), use **Application Default Credentials** for tools that expect ADC:

```bash
gcloud auth application-default login
```

Point at production (see [gcp-infrastructure.md](./gcp-infrastructure.md)):

```bash
gcloud config set project sophia-488807
```

### Export `[INGEST_TIMING]` (widen N vs Neon envelope)

Ingest prints **`[INGEST_TIMING] {json}`** from `scripts/ingest.ts` on stdout; Cloud Run captures it. Query **both** the dedicated worker and the main app service (admin ingest children can run on either — see [gcp-ingest-worker.md](./gcp-ingest-worker.md)):

```bash
FILTER='resource.type="cloud_run_revision" AND (resource.labels.service_name="sophia-ingest-worker" OR resource.labels.service_name="sophia") AND textPayload:"INGEST_TIMING"'
```

Export last **90 days** to a JSON file (adjust `--freshness` / `--limit` as needed; very large exports may need **Log Analytics / BigQuery** instead):

```bash
gcloud logging read "$FILTER" \
  --project=sophia-488807 \
  --freshness=90d \
  --format=json \
  --limit=5000 \
  > /tmp/ingest-timing-gcp.json
```

Aggregate (mean / p50 / p90 fractions, corr, calls — same spirit as §1.2 / §2):

```bash
pnpm ops:phase0-timing-from-gcp-export -- /tmp/ingest-timing-gcp.json
```

**What to do next:** (1) If GCP **`[INGEST_TIMING]`** exports show **different** tail behavior than Neon envelopes, add a short “source: GCP export” subsection with **N** and key percentiles. (2) If counts are still low, increase `--limit`, widen freshness, or set up a **saved query / sink** so you are not capped by CLI pagination. (3) **Dedupe:** the script dedupes on log `insertId` only; if the same run appears twice with different ids, add a run-key field to `[INGEST_TIMING]` later or dedupe in BigQuery on `run_started_at_ms` + `total_wall_ms`.

**Per-call extraction durations (`[INGEST_TELEMETRY]`):**

```
textPayload=~"\[INGEST_TELEMETRY\\]"
jsonPayload.message=~"\[INGEST_TELEMETRY\\]"
```

(Adjust to your export schema: some sinks put the line in `textPayload`, others parse JSON.)

Filter parsed JSON where `jsonPayload.event="model_call_end"` AND `jsonPayload.stage="extraction"` (if parsed to structured fields).

**Legacy example (regex on `{`):**

```
resource.type="cloud_run_revision"
logName=~"stdout"
textPayload=~"\[INGEST_TIMING\] \\{"
```
