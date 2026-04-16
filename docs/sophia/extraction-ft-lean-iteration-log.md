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

When you run the first post-baseline `eval-extraction-compare`, paste the **`summary`** block from `eval-compare-*.json` into a new dated section above as **Iteration 1 — measured**.
