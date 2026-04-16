# Fine-tuned extraction — golden A/B evidence & recommendations

**Date:** 2026-04-16  
**Scope:** Offline **golden holdout** (`golden_holdout.jsonl`) and **combined eval-compare** artefacts already on disk. **Ingest gates** (`[INGEST_TIMING]`, batch splits, live `passage_id` grounding) are **explicitly out of scope** here — see Phase 0 §3 in [`docs/local/operations/phase0-extraction-ingestion-baseline-report.md`](../local/operations/phase0-extraction-ingestion-baseline-report.md) when you need worker telemetry.

**Not legal advice.**

---

## 1. Frozen inputs (do not change when pairing)

| Field | Value |
|--------|--------|
| JSONL | [`data/phase1-training-export/golden_holdout.jsonl`](../../data/phase1-training-export/golden_holdout.jsonl) (**723** rows in file) |
| Eval row cap used in all tables below | **`--limit 200`** (first 200 rows, same order as file) |
| `cohortFingerprintSha256_16` | `6ab6bd1d739097a0` |
| `goldenFingerprintSha256_16` | `98abe3de579ef460` |
| Manifest | [`data/phase1-training-export/manifest.json`](../../data/phase1-training-export/manifest.json) (`generatedAt` **2026-04-15** on export used by eval-compare) |

Primary success metric for this JSONL shape: **`subsetTextMatchRate`** (sentence-level gold `text` vs model claim `text`). **`subsetMatchRate`** (text + gold `position_in_source`) stays **low by design** — gold positions are **document-level** while each eval row is a **single-sentence** `input`; see [`scripts/eval-extraction-holdout-openai-compatible.ts`](../../scripts/eval-extraction-holdout-openai-compatible.ts) header and [`extraction-fireworks-deploy.md`](./extraction-fireworks-deploy.md) §5.

---

## 2. Machine evidence — golden **200** (paired slice)

All runs: **`golden_holdout.jsonl`**, **`--limit 200`**, **`--mismatch-diagnostics`** where noted.

| Arm | Report path | `modelId` | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` | Latency p50 / p95 (ms) | Mismatch `hit` / `gold_text_wrong_position` (eligible ≈199) |
|-----|-------------|-----------|------------------|----------------------|-------------------|-------------------------|---------------------------------------------------------------|
| FT (historical spike) | [`eval-fireworks-extraction.json`](../../data/phase1-training-export/eval-fireworks-extraction.json) | `…/deployments/ytv2kq38` | 0.995 | **1** | **0** | 1856 / 2069 | **0** / **199** |
| FT (Step F, `keo1sj4o`) | [`eval-step-f-golden-200-2026-04-16.json`](../../data/phase1-training-export/eval-step-f-golden-200-2026-04-16.json) | `…/deployments/keo1sj4o` | 0.995 | **1** | **~0.01** | 1843 / 2062 | **2** / **197** |
| FT (combined eval, `hz8ot3bv`) | Embedded in [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) → `goldenHoldout.report` | `…/deployments/hz8ot3bv` | 0.995 | **1** | **~0.005** | 1847 / 2088 | **1** / **198** |

**Read-across:** On this **fixed 200-row** slice, **every** Fireworks deployment above hits **`subsetTextMatchRate = 1`** on subset-eligible rows and **`schemaPassRate ≈ 0.995`** (one schema fail per 200 rows — same failure *rate*, not yet proven to be the *same* row without row-id diffing). Latencies are **tight** (~1.8–1.9 s p50). **FT vs FT** on sentence match does **not** separate candidates — the metric is **saturated** here.

---

## 3. Broader slice inside same eval-compare run (`hz8ot3bv`, limit 200)

From [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) `summary`:

| Slice | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` | p50 / p95 (ms) |
|-------|------------------|----------------------|-------------------|----------------|
| Golden (nested) | 0.995 | **1** | ~0.005 | 1847 / 2088 |
| Remit multi-domain (`eval_remit_multidomain.jsonl`) | **0.985** | **1** | ~0.005 | 1946 / 2377 |

**Read-across:** Remit is **slightly** harder on **schema** (0.985 vs 0.995) but **sentence match stays at ceiling** for this sample. Good sign for **breadth**, still **n = 200** per slice.

---

## 4. Catalog baseline pairing (OpenAI `gpt-4o-mini`) — **required to finish “vs initial bar”**

You asked to set ingest gates aside but still **pair against a non–FT baseline**. That pairing is **not** in `data/phase1-training-export/` yet.

**Command** (overrides `EXTRACTION_*` for this process only; uses `OPENAI_API_KEY` from your env file):

```bash
cd /Users/adamboon/projects/sophia
EXTRACTION_BASE_URL=https://api.openai.com/v1 \
EXTRACTION_MODEL=gpt-4o-mini \
pnpm exec tsx --env-file=.env.local scripts/eval-extraction-holdout-openai-compatible.ts -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-golden-baseline-gpt4o-mini-200.json
```

**When the file exists:** append its headline metrics to the table in **§2** (or a new row in [`extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md)) and re-state the recommendation. **If** `subsetTextMatchRate` and `schemaPassRate` are **non-inferior** to FT on the same 200 rows, the **economic** decision shifts to **cost/latency** and **ingest** behaviour (out of scope here). **If** baseline **beats** FT on schema or text match, **pause** further FT spend until you diagnose (data, prompt fold, temperature, deployment).

A long-running local job was started toward [`eval-golden-baseline-gpt4o-mini-200.json`](../../data/phase1-training-export/eval-golden-baseline-gpt4o-mini-200.json); if it never appears, re-run the command above and watch for rate limits or key scope.

---

## 5. Recommendations

1. **Treat current FT evidence as “meets Step F–style golden/remit bars on n=200”** — aligned with the existing **Go** narrative in [`extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md) (schema pilot ~0.995, **`subsetTextMatchRate` 1** on eligible rows). **Do not** claim **strict** `subsetMatchRate` gains; the eval contract makes that metric misleading.

2. **Do not use golden-200 alone to pick between `ytv2kq38` / `keo1sj4o` / `hz8ot3bv`** — sentence-level match is **flat**; choose on **ops** (deployment stability, cost, ingest policy) or **narrower** probes (schema-failure row inspection).

3. **Complete §4 baseline file** before any **prompt** or **training-data** change intended to “beat baseline” — otherwise you cannot attribute deltas.

4. **Additional testing (recommended order):**
   - **Full golden 723** — same command pair, `--limit 723`, same two `EXTRACTION_*` profiles (baseline + chosen FT). Low incremental ambiguity vs 200 if rates stay stable.
   - **Schema failure archaeology** — `EXTRACTION_EVAL_LOG_FIRST_FAILURE=1` with `--limit 50` on the arm that fails **one** row per 200; confirm whether failures **coincide** across models.
   - **Re-run `pnpm ops:eval-extraction-compare`** after any manifest / `golden_holdout` regeneration (fingerprints **must** match for trend lines).

5. **When ingest gates return:** re-use the same **FT vs baseline** decision only after you add **`[INGEST_TIMING]`** / log-metrics pairs on a **small** fixed URL set (see [`extraction-offline-regression-pack.md`](./extraction-offline-regression-pack.md) §0 / §3a).

---

## 6. Related docs

| Topic | Path |
|-------|------|
| Vendor spike table + commands | [`docs/local/operations/extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md) (under `docs/local/` — **gitignored** in this repo; copy table rows there only if your fork tracks it) |
| A/B protocol (prompt freeze, golden-first commands) | [`extraction-offline-regression-pack.md`](./extraction-offline-regression-pack.md) §0 |
| Step F audit log | [`docs/local/operations/phase2-step-f-local-verification-log.md`](../local/operations/phase2-step-f-local-verification-log.md) |
| Combined eval driver | [`scripts/eval-extraction-compare.ts`](../../scripts/eval-extraction-compare.ts) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-16 | Initial report: golden-200 evidence table (three FT deployments), eval-compare summary, catalog baseline command, recommendations, follow-up tests. |
