# Extraction fine-tuning — iteration log (Lean: hypothesize → build → measure → learn)

**Purpose:** One row per FT experiment. **Do not edit past rows** — append new dated sections. Pair every training run with **the same two-slice eval** and a combined report (see [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md)).

**Canonical plan (steps + todos):** [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md).

**Prerequisites:** [../local/operations/ingestion-fine-tune-data-mitigation-plan.md](../local/operations/ingestion-fine-tune-data-mitigation-plan.md) (G0/G1), [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) (deploy + **SFT addendum**), [../local/operations/phase2-step-d-artifacts-runbook.md](../local/operations/phase2-step-d-artifacts-runbook.md) (merge/lineage when shipping **uploaded** weights). **Legacy Together-only packaging:** [../local/operations/together-lora-phase2-runbook.md](../local/operations/together-lora-phase2-runbook.md).

**Vendor eval archive:** [../local/operations/extraction-vendor-ft-spike-eval-record.md](../local/operations/extraction-vendor-ft-spike-eval-record.md).

**Who does what:** [extraction-ft-lean-pause-points.md](./extraction-ft-lean-pause-points.md) (PAUSE 0 = warm endpoint + env before eval).

---

## How to append a new iteration

Copy the **Iteration template** block below into a new `## YYYY-MM-DD — Iteration N` section, fill every field, attach `eval-compare-*.json` path, then commit the doc + JSON (or store JSON under `data/phase1-training-export/` and reference path only).

---

## Iteration template (copy below this line)

### Hypothesis (one paragraph)

> State the **single** falsifiable claim (which metric moves, on which slice, and why).

### Build (minimal diff — one primary lever)

| Field | Value |
|-------|--------|
| Training delta | e.g. “+220 rows batch-shaped JSON in `train.jsonl`” or “epochs 1 → 2 on Fireworks” |
| Packaged chat JSONL | `train.together.jsonl` / `validation.together.jsonl` paths + line counts or hashes |
| **Fireworks SFT** (preferred) | Job id / output model id; **or** `fireworks-sft-job-submitted.json` path |
| **Together** (legacy) | Together job id if you used `pnpm ops:together-submit-finetune` |
| Base / warm-start | **First SFT:** `accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft` if Tunable; else catalog base. **Next:** `--warm-start-from` prior SFT output model id |
| Row cap / notes | |

**Commands (preferred — Fireworks SFT):**

```bash
# Step A (after export change) — output is generic chat JSONL
pnpm ops:phase2-step-a-together-packaging -- --export-dir data/phase1-training-export

# Fireworks: dry-run then live (set FIREWORKS_API_KEY; FIREWORKS_ACCOUNT_ID or EXTRACTION_MODEL for account inference).
# First SFT from uploaded merged extraction weights (`firectl model get sophia-extract-m7b-ft` → Tunable: true verified 2026-04-16).
# Use a real slug (lowercase, digits, hyphens) — do NOT wrap in <angle brackets>; zsh treats < as redirection.
# **zsh:** each `\` must be the *last* character on the line (no spaces after it). If you see `parse error near '}'`,
# retype the line breaks or use the **one-line** command below (same flags, no backslashes).
# One-line dry-run:
# pnpm ops:fireworks-submit-sft -- --dry-run --training-file data/phase1-training-export/train.together.jsonl --validation-file data/phase1-training-export/validation.together.jsonl --base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft --output-model sophia-extract-sft-iter1
# One-line live (drops --dry-run; saves report):
# pnpm ops:fireworks-submit-sft -- --training-file data/phase1-training-export/train.together.jsonl --validation-file data/phase1-training-export/validation.together.jsonl --base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft --output-model sophia-extract-sft-iter1 --write-report data/phase1-training-export/fireworks-sft-job-submitted.json

pnpm ops:fireworks-submit-sft -- --dry-run \
  --training-file data/phase1-training-export/train.together.jsonl \
  --validation-file data/phase1-training-export/validation.together.jsonl \
  --base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft \
  --output-model sophia-extract-sft-iter1

pnpm ops:fireworks-submit-sft -- \
  --training-file data/phase1-training-export/train.together.jsonl \
  --validation-file data/phase1-training-export/validation.together.jsonl \
  --base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft \
  --output-model sophia-extract-sft-iter1 \
  --write-report data/phase1-training-export/fireworks-sft-job-submitted.json

# Later iteration: continue from prior Fireworks SFT output (omit --base-model):
# pnpm ops:fireworks-submit-sft -- ... \
#   --warm-start-from accounts/adam-boon1984-17nryg/models/my-prior-sft-output \
#   --output-model sophia-extract-sft-iter2
```

Then **`firectl deployment create sophia-extract-sft-iter1`** (same short id as `--output-model`) when the job completes — see [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md).

**Commands (legacy — Together LoRA):**

```bash
pnpm ops:together-submit-finetune -- --dry-run
pnpm ops:together-submit-finetune -- \
  --training-file data/phase1-training-export/train.together.jsonl \
  --validation-file data/phase1-training-export/validation.together.jsonl
```

### Measure (same machine-readable reports every time)

**Fingerprints** (from `manifest.json` at eval time — must match baseline if comparing to prior iterations):

| `cohortFingerprintSha256_16` | `goldenFingerprintSha256_16` |
|------------------------------|--------------------------------|
| | |

**Combined eval (preferred):**

```bash
pnpm ops:eval-extraction-compare -- \
  --export-dir data/phase1-training-export \
  --limit 200 \
  --out data/phase1-training-export/eval-compare-ITER-ID.json
```

**Schema smoke (5 rows) if `schemaPassRate` regresses:**

```bash
EXTRACTION_EVAL_LOG_FIRST_FAILURE=1 pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 5 \
  --out data/phase1-training-export/eval-golden-smoke-5.json
```

| Slice | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` (optional) | Latency p50 / p95 (ms) | Report path |
|-------|------------------|----------------------|--------------------------------|-------------------------|-------------|
| Golden holdout (200) | | | | | |
| Remit multidomain (200) | | | | | |

`EXTRACTION_MODEL` / endpoint used for eval:

### Learn (decision)

| Decision | One line rationale |
|----------|--------------------|
| **Ship / iterate / stop** | |
| **Next hypothesis** (if iterate) | |

**Abort reminders:** If `schemaPassRate` is flat vs prior after a checkpoint, **stop** burning epochs — fix format supervision. If golden improves but remit drops, add breadth / regularisation next.

---

## Cycle 1 — Format / batch-shaped JSON (planned hypothesis)

> **Hypothesis:** Adding 200–500 supervised rows where the user turn matches **multi-passage** `EXTRACTION_USER` (token band aligned with `INGEST_EXTRACTION_*` batch caps) and the assistant is **only** a valid `[{...}]` array increases **`schemaPassRate`** on `golden_holdout.jsonl` (limit 200) without dropping **`subsetTextMatchRate`** on the remit slice by more than an agreed epsilon (record epsilon here: _____).

### Build checklist

- [ ] Curate or synthesise batch-shaped rows; merge into export `train.jsonl` (or a **branch export dir**) per G1.
- [ ] `pnpm ops:phase2-step-a-together-packaging` for the export dir in use.
- [ ] **Fireworks:** `pnpm ops:fireworks-submit-sft -- --dry-run` then live; record job + `output-model` in template table; deploy when ready.
- [ ] **Legacy:** `pnpm ops:together-submit-finetune` only if you explicitly choose Together.

### Measure checklist

- [ ] Point `EXTRACTION_*` at the new **Fireworks deployment** (or other OpenAI-compatible endpoint).
- [ ] `pnpm ops:eval-extraction-compare` → save `eval-compare-cycle-1-*.json`.
- [ ] Fill metrics table; compare to [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md) or previous iteration row.

### Learn checklist

- [ ] Record ship / iterate / stop and next hypothesis.

---

## Cycle 2 — `passage_id` grounding (planned hypothesis)

> **Hypothesis:** A small hand-built eval JSONL (~50 rows) where gold **`passage_id`** is unambiguous in the user block improves **in-batch ID match rate** on that slice (define counting script or manual rubric); optional second measure: fewer **`passage_id` did not resolve** warnings on a fixed SEP ingest smoke (1–2 batches).

### Build checklist

- [ ] Author `data/phase1-training-export/eval_passage_id_grounding.jsonl` (or path TBD) with same row shape as holdout eval; extend `eval-extraction-holdout-openai-compatible` **or** document `pnpm ops:eval-extraction-holdout-openai-compatible -- --jsonl …` against that file.
- [ ] Add matching supervision rows to training pack; Step A → **Fireworks SFT** (or legacy Together).

### Measure checklist

- [ ] Run holdout + remit compare **plus** new slice (document exact command in iteration row when added).
- [ ] Optional: ingest smoke on frozen `data/sources/*.txt` with orchestration env; capture `[WARN] passage_id` lines.

### Learn checklist

- [ ] Record decision and whether ingest smoke matched offline trend.

---

## 2026-04-16 — Iteration 1 (measured)

**Report:** [`data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) (`generatedAt` in file: **2026-04-16T13:06:41.859Z**).

**Build context (operator):** Fireworks SFT job submitted same day (`outputModel` `sophia-extract-sft-iter1`, job name pattern `…/supervisedFineTuningJobs/sug7y6zc` in `fireworks-sft-job-submitted.json`). **Verify** `EXTRACTION_MODEL` for this eval matches the deployment you intend (here: **`accounts/adam-boon1984-17nryg/deployments/hz8ot3bv`**).

### Fingerprints (manifest at eval time)

| `cohortFingerprintSha256_16` | `goldenFingerprintSha256_16` |
|------------------------------|--------------------------------|
| `6ab6bd1d739097a0` | `98abe3de579ef460` |

### `summary` (from combined JSON)

```json
{
  "golden": {
    "schemaPassRate": 0.995,
    "subsetTextMatchRate": 1,
    "subsetMatchRate": 0.005025125628140704,
    "latencyMs": { "p50": 1847, "p95": 2088 },
    "modelId": "accounts/adam-boon1984-17nryg/deployments/hz8ot3bv"
  },
  "remit": {
    "schemaPassRate": 0.985,
    "subsetTextMatchRate": 1,
    "subsetMatchRate": 0.005076142131979695,
    "latencyMs": { "p50": 1946, "p95": 2377 },
    "modelId": "accounts/adam-boon1984-17nryg/deployments/hz8ot3bv"
  }
}
```

### Slice detail (from full reports)

| Slice | Rows | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` | Notes |
|-------|------|-------------------|----------------------|-------------------|--------|
| Golden holdout | 200 | **0.995** (1 schema fail) | **1.0** (199 eligible) | ~0.005 | `gold_text_wrong_position` dominates strict match (document-level gold position vs single-sentence row — **expected**; do not read as extraction failure). |
| Remit multidomain | 200 | **0.985** (3 schema fails) | **1.0** (197 eligible) | ~0.005 | Same mismatch story; **watch** remit schema vs golden if tuning for format. |

### Golden: Fireworks FT vs **`gemini-3-flash-preview`** (prod model id; offline eval)

Parallel **4×50** shard runs with **`EXTRACTION_MODEL=gemini-3-flash-preview`** (Generative Language OpenAI-compatible host — **not** identical to regional **Vertex** in prod, same model id). Merged report: [`data/phase1-training-export/eval-golden-baseline-gemini-3-flash-merged-216.json`](../../data/phase1-training-export/eval-golden-baseline-gemini-3-flash-merged-216.json) (**216** rows after merge; see caveat in [extraction-ft-golden-ab-recommendations.md](./extraction-ft-golden-ab-recommendations.md) §2.1).

| Arm | Rows | `schemaPassRate` | `subsetTextMatchRate` | p50 / p95 (ms) |
|-----|------|------------------|----------------------|----------------|
| **FT `hz8ot3bv`** (same iteration) | 200 | **0.995** | **1.0** | 1847 / 2088 |
| **Gemini flash (eval)** | 216 (merged) | **~0.741** | **~0.419** | ~31 944 / ~38 512 |

Full interpretation: [extraction-ft-golden-ab-recommendations.md](./extraction-ft-golden-ab-recommendations.md) §2.1.

**Speed / ops note:** The comparison was partly to see if we could **shorten extraction wall time** vs Vertex-backed production; offline numbers favour **FT** on latency and robustness vs this flash client, but **ingest-level** validation (`stage_ms.extracting` vs historical baselines) is still required. **Fireworks capacity** remains a **reliability** concern for depending on FT as primary hosting.

### Learn (provisional)

| Decision | Rationale |
|----------|-----------|
| **Iterate / confirm** | Golden **schema** aligns with prior vendor spike (~0.995). Remit **slightly lower** schema (0.985 vs 0.995) — worth `EXTRACTION_EVAL_LOG_FIRST_FAILURE=1` on a **5-row remit smoke** to inspect the 3 failures if they persist after SFT completes. |
| **Next** | Re-run **`pnpm ops:eval-extraction-compare -- --out …/eval-compare-<label>-200.json`** after SFT finishes and **`EXTRACTION_MODEL`** points at the **new** tuned deployment; diff `summary` vs this file. Optional: SEP ingest smoke if offline gates hold. |

---

## Cycle 3 — Prod failure exemplars (planned hypothesis; G1-dependent)

> **Hypothesis:** After cycles 1–2, adding ≤100 **G1-cleared**, redacted rows mined from production **`[JSON_FAIL]`** / repair traces (assistant = corrected JSON array) reduces **`ingest_model_json_parse_failed`** rate on a fixed SEP smoke ingest without offline metric regression.

### Preconditions

- [ ] Counsel / ToS clearance for using mined text in training (see mitigation plan §G1).
- [ ] Strip PII / operator identifiers from exemplars.

### Build / measure / learn

- [ ] Curate exemplar JSONL → merge → Step A → **Fireworks SFT** (or legacy Together).
- [ ] Offline: `pnpm ops:eval-extraction-compare` vs previous winner.
- [ ] Online: SEP smoke ingest only if offline gates pass; compare telemetry counts.

---

## Iteration 0 (baseline pointer only)

Metrics and commands are frozen in **[extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md)**. Historical vendor spike numbers remain in **[../local/operations/extraction-vendor-ft-spike-eval-record.md](../local/operations/extraction-vendor-ft-spike-eval-record.md)**.

First post-baseline combined eval is recorded in **Iteration 1 (2026-04-16)** above; use **`--out data/phase1-training-export/eval-compare-<date>-<deployment>-limit200.json`** for subsequent runs so reports are not overwritten by the default `eval-compare.json`.

---

## 2026-04-16 — Plan note: Vertex as production extraction default

**Decision:** Live **ingestion extraction** is treated as **Vertex-first** (`vertex:…` Gemini ids in ingest config): it is the route we can operate **reliably** and still **reuse extractions for future training** under our pipeline and governance. **Fireworks SFT + FT deployments** stay the primary path for **training iterations and offline** `pnpm ops:eval-extraction-*` comparisons — that routing split is documented in [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md) § *Production extraction model — Vertex (plan change)*.
