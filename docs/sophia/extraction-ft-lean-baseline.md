# Extraction FT — Iteration 0 baseline (frozen metrics)

**Purpose:** Canonical **two-slice eval** for every Lean FT cycle (hypothesis → build → measure → learn). Re-run after each deployment or model change; append results to [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md).

**Full plan (Fireworks SFT primary, checklists):** [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md).

**Operator vs agent:** [extraction-ft-lean-pause-points.md](./extraction-ft-lean-pause-points.md) lists **PAUSE 0–3** (endpoint, cycles 1–3) so you know when your action is required before the next automated step.

**Not legal advice.** G0/G1: [../local/operations/ingestion-fine-tune-data-mitigation-plan.md](../local/operations/ingestion-fine-tune-data-mitigation-plan.md).

---

## Export vintage fingerprints (do not compare runs across different values)

From [data/phase1-training-export/manifest.json](../../data/phase1-training-export/manifest.json) (snapshot 2026-04-15):

| Key | Value |
|-----|--------|
| `cohort.cohortFingerprintSha256_16` | `6ab6bd1d739097a0` |
| `goldenSet.fingerprintSha256_16` | `98abe3de579ef460` |
| `manifest.generatedAt` | `2026-04-15T20:24:46.884Z` |

If your local `manifest.json` differs, copy the two `*_16` values from **your** export into each eval report or iteration row.

---

## Required env (same as ingest extraction route)

- `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`
- `EXTRACTION_API_KEY` or `OPENAI_API_KEY` (Together/Fireworks per [scripts/eval-extraction-holdout-openai-compatible.ts](../../scripts/eval-extraction-holdout-openai-compatible.ts) header)

Optional: `EXTRACTION_EVAL_FOLD_SYSTEM` must match training packaging (default folded user = Step A default).

**Production vs offline eval:** Ingestion in production uses **Vertex** (`vertex:…` model ids) as the go-to extraction route so runs stay **reliable** and outputs remain **eligible for reuse in future training** under our constraints — see **Production extraction model — Vertex** in [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md). Holdout scripts in this doc often point `EXTRACTION_*` at **Fireworks** (or OpenAI-compatible baselines) for **FT A/B**; do not assume the same host as prod without checking the report’s `modelId` / `inferenceHost`.

**Measured gap (golden slice):** Custom Fireworks FT vs **`gemini-3-flash-preview`** (offline Google eval, same model id as prod flash) — headline metrics and caveats in [extraction-ft-golden-ab-recommendations.md](./extraction-ft-golden-ab-recommendations.md) §2.1.

**Fireworks capacity / other hosts:** If deployments are hard to schedule, see [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) § *Availability, capacity, and alternative hosting* (fallback routing, Vertex endpoint, GKE, other providers).

---

## Canonical commands (fixed `--limit 200`)

**One-shot (both slices + combined sidecar JSON):**

```bash
# Same as below if you omit flags: writes data/phase1-training-export/eval-compare.json
pnpm ops:eval-extraction-compare

pnpm ops:eval-extraction-compare -- \
  --export-dir data/phase1-training-export \
  --limit 200 \
  --out data/phase1-training-export/eval-compare-baseline.json
```

**Manual (same behaviour as the wrapper):**

```bash
# Golden URL holdout
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-golden-200.json

# Multi-domain remit (regenerate JSONL if export changed — seed 42 for reproducibility)
pnpm ops:sample-extraction-remit-eval-jsonl -- \
  --export-dir data/phase1-training-export \
  --out data/phase1-training-export/eval_remit_multidomain.jsonl \
  --total 200 \
  --seed 42

pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/eval_remit_multidomain.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-remit-200.json
```

---

## Primary gates (interpretation)

| Metric | Use |
|--------|-----|
| `schemaPassRate` | **Stop training** if stuck low vs prior iteration on the **same** JSONL vintage — fix supervision / format. |
| `subsetTextMatchRate` (eligible rows) | **Primary quality** on sentence-level golden rows. |
| `subsetMatchRate` + `mismatchDiagnostics` | Secondary; expect `gold_text_wrong_position` dominance for single-sentence eval (see eval script header). |

---

## Historical baseline reports (Step F vendor spike)

See [../local/operations/extraction-vendor-ft-spike-eval-record.md](../local/operations/extraction-vendor-ft-spike-eval-record.md) for paths such as `eval-step-f-golden-200-2026-04-16.json` and `eval-fireworks-remit-multidomain.json`. Re-run with your current `EXTRACTION_MODEL` and record metrics in the iteration log.

---

## Smoke when schema regresses

```bash
EXTRACTION_EVAL_LOG_FIRST_FAILURE=1 pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 5 \
  --out data/phase1-training-export/eval-golden-smoke-5.json
```
