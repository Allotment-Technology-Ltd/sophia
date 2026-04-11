# Phase 0 — Extraction spike prep (measurement & gates)

**Scope:** Baseline wall time, extraction sub-breakdown signals, quality gates, golden eval set proposal, hypotheses, and go/no-go. No model training or serving design.

**Production snapshot (Neon):** Aggregates below were pulled with **Neon MCP `run_sql`** against project **`sophia`** on **2026-04-11**, window **`completed_at` last 90 days**, predicates `status = 'done'`, `cancelled_by_user = false`, `completed_at IS NOT NULL`, and `report_envelope` containing **`timingTelemetry.stage_ms`**.

**Coverage caveat:** In this window, **59** completed runs had `timingTelemetry.stage_ms`, but only **10** had a usable numeric **`total_wall_ms`** in the same envelope (non-null / non-zero). **Percent-of-E2E and §6.1 stage table statistics use the N = 10 cohort** (runs where `total_wall_ms` is present). Broader runs still contribute to **issue counts** (65 runs with any `report_envelope`) and to **model-call concentration** when keyed only on `model_calls.extraction` (see §2).

**GCP Logging:** Optional `[INGEST_TELEMETRY]` / `[INGEST_TIMING]` sampling was **not run** in the original agent session (token refresh / non-interactive auth). **Operators:** authenticate in a normal terminal (browser handshake), export logs, then run the repo script below to widen **N** beyond Neon `report_envelope` completeness.

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

From the first aggregate query (§1.2, **N = 10** rows with `total_wall_ms`, 2026-04-11 pull):

- **`frac_extract_mean` ≈ 0.2435** → **Mean % extraction of E2E ≈ 24.4%**
- **`frac_extract_p90` ≈ 0.4654** → **p90 % extraction of E2E ≈ 46.5%**

On the same cohort, **mean** `stage_ms` / `total_wall_ms` shares were approximately **validating 38.7%**, **remediating 20.2%**, **storing 14.0%** (see §6.5).

**Caveat:** `total_wall_ms` is process wall clock from `run_started_at_ms` to summary; it includes planning and any gaps **not** attributed to a `stage_ms` bucket. In this snapshot many completed runs lacked `total_wall_ms` in `report_envelope` (see environment note); backfill or log-based `total_wall_ms` would widen **N** before treating percentiles as stable.

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

**Production read (2026-04-11, Neon):** On the **N = 10** runs that have both `total_wall_ms` and `model_call_wall_ms.extraction`, **Pearson corr(`extracting_ms`, `model_call_wall_ms.extraction`) ≈ 0.85** — extraction wall time moves with extraction-stage model wall time, consistent with **model latency / call count** driving much of `stage_ms.extracting` in this slice.

Across **49** completed runs in 90d that expose `model_calls.extraction` (broader than the N = 10 E2E cohort), the same correlation is **≈ 0.73**, with **median ~4** extraction calls per run (**p90 ~5**), and **median implied ms/call** (`model_call_wall_ms.extraction / calls`) **≈ 60k** (**p90 ≈ 95k**). That pattern is **moderate call count** with **heavy per-call wall**, not hundreds of tiny calls.

**`timingTelemetry` repair/retry fields (N = 10 E2E cohort):** `batch_splits` and `recovery_agent_invocations` are **0 at p50 and p90**; `json_repair_invocations` **p90 ≈ 1** (median 0); `model_retries` **p90 = 0** on this slice. **`ingest_run_issues`** on **65** done runs with any `report_envelope` in the window: **`json_repair` 127**, **`retry` 26**, **`ingest_retry` 11**, **`recovery_agent` 0** rows (kinds filtered to repair/retry family). So **JSON repair pressure shows up in issues more than in the timing counters** for runs that omit `total_wall_ms`, and concentration metrics should be revisited after envelope completeness improves.

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

**Storage:** `docs/operations/golden-extraction-eval.json` (machine-readable list + SQL hint for `web_article` rows).

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

1. **Downstream validation + remediation dominate mean E2E** — On the **N = 10** `total_wall_ms` cohort, **mean** wall fractions are roughly **validating ~39%**, **remediating ~20%**, **storing ~14%**, **extracting ~24%**. A bespoke extractor alone does not address the largest **mean** buckets unless it indirectly collapses validation/remediation work.
2. **Model latency still shapes extraction** — **Corr(extracting, `model_call_wall_ms.extraction`) ≈ 0.85** on the N = 10 cohort (§2.1), with **~4–5** calls/run and **~60–95s per call** at median/p90 in the broader 49-run slice — **fewer, longer calls** dominate extraction wall more than “dozens of micro-calls”.
3. **JSON repair / truncation** — Issue volume **`json_repair` 127** on 65 runs with reports vs **low** `json_repair_invocations` / `batch_splits` in the small timing slice suggests **telemetry/envelope completeness** and **issue logging** capture repair pressure that is not fully reflected in `timingTelemetry` aggregates until `total_wall_ms` is consistently present. **Rank 2 vs 3** for extraction-only spikes: prefer **instrumentation + golden re-runs** before betting on a format-only model change.

*(Re-ranked after Neon baseline, 2026-04-11.)*

---

## 6) Deliverables checklist

### 6.1 Table — stage × p50 / p90 / max / mean wall ms (sample N)

**N = 10** (done runs, last 90 days, `timingTelemetry.stage_ms` present **and** `total_wall_ms` non-null in envelope). Values rounded to nearest ms except planning (sub-second).

| stage (`stage_ms` or planning sum) | p50 ms | p90 ms | max ms | mean ms |
|------------------------------------|--------|--------|--------|---------|
| extracting | 162,850 | 523,169 | 532,902 | 191,847 |
| relating | 9,040 | 12,832 | 14,397 | 7,531 |
| grouping | 2,616 | 13,911 | 28,170 | 5,810 |
| embedding | 1,458 | 1,920 | 2,091 | 1,134 |
| validating | 195,772 | 458,726 | 489,141 | 243,465 |
| remediating | 84,233 | 247,506 | 359,921 | 124,459 |
| storing | 85,257 | 119,016 | 131,762 | 86,720 |
| planning | 5 | 6 | 6 | 5 |

Source: **“All stages + planning”** SQL block in §1.2 (`f` CTE), executed via Neon on 2026-04-11.

**By `source_type` (same `f` cohort):** only **`sep_entry`** appears — **n = 10**, **mean_frac_extract ≈ 0.244**, extracting **p50 ≈ 162,850 ms**, **p90 ≈ 523,169 ms** (§1.2 `GROUP BY source_type` query).

### 6.2 Paragraph — % of E2E in extraction (mean + p90)

Over the last **90 days**, among **N = 10** completed ingest runs with usable `total_wall_ms` in `report_envelope.timingTelemetry`, **`extracting` accounted for ~24.4%** of `total_wall_ms` **on average** and **~46.5%** at **p90** (fractions **0.2435** and **0.4654** from the extraction-fraction aggregate in §1.2). **Interpret cautiously:** **59** runs had `stage_ms` telemetry in the same window but lacked `total_wall_ms`, so the headline **N** is small and may skew toward worker paths that persist full timing summaries.

### 6.3 Quality gates (summary)

See §3 — numeric thresholds should be **derived from one baseline golden batch** once `[INGEST_TIMING]` + validation logs are frozen.

### 6.4 Golden set + storage path

- **Path:** `docs/operations/golden-extraction-eval.json`
- **Contents:** 40 curated SEP URLs + rationale fields; operators should append **5–10** `web_article` URLs from Neon (`SELECT source_url, … FROM ingest_runs WHERE source_type = 'web_article' AND status = 'done' …`).

### 6.5 Go / no-go (one paragraph)

**No-go (defer bespoke extraction as the primary Phase-1 bet)** on current numbers: **mean** `extracting` is **~24%** of `total_wall_ms` — below the **~35–40%** “large mean share” gate — while **`validating` (~39% mean)** plus **`remediating` (~20%)** and **`storing` (~14%)** dominate typical E2E wall in the **N = 10** cohort. **Extraction is still material at the tail** (**~46.5%** of E2E at **p90**), and **corr(extracting, `model_call_wall_ms.extraction`) ≈ 0.85** on that cohort supports tuning **extraction model speed / call shape** for tail latency — but **ROI first** belongs to **validation + remediation + store path** (and to **fixing `total_wall_ms` / timing envelope coverage** so **N** is not 10/59). **Revisit “Go” on bespoke extraction** if, after envelope backfill, **mean** extracting share rises materially **or** golden runs show **`json_repair` / truncation** concentrated on extraction with **`model_call_wall_ms.extraction` ≈ `stage_ms.extracting`** and **high** `json_repair_invocations` in timing (not only in `ingest_run_issues`).

---

## File paths referenced

| Path | Role |
|------|------|
| `scripts/ingest.ts` | `[INGEST_TIMING]`, `[TIMING]`, `IngestTimingPayload`, extraction loop, faithfulness logs |
| `src/lib/server/ingestion/ingestionTelemetry.ts` | `[INGEST_TELEMETRY]` prefix and heartbeat |
| `src/lib/server/ingestRunIssues.ts` | `parseIngestTimingFromLogLines`, report envelope shape |
| `src/lib/server/db/schema.ts` | `ingest_runs`, `ingest_run_logs`, `ingest_run_issues`, `report_envelope` |
| `src/lib/server/db/ingestRunRepository.ts` | `neonSetReportEnvelope`, timing line subquery |
| `docs/operations/gcp-ingest-worker.md` | Logging / watchdog context |
| `docs/operations/ingestion-golden-sep-corpus.md` | Pins + comparability for validation |

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

**What to do next:** (1) If **`with total_wall_ms > 0`** from the script is **much larger** than Neon’s **10**, refresh §6.1–§6.5 using log-derived numbers (and note “source: GCP export”). (2) If counts are still low, increase `--limit`, widen freshness, or set up a **saved query / sink** so you are not capped by CLI pagination. (3) **Dedupe:** the script dedupes on log `insertId` only; if the same run appears twice with different ids, add a run-key field to `[INGEST_TIMING]` later or dedupe in BigQuery on `run_started_at_ms` + `total_wall_ms`.

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
