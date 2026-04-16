# Lean extraction FT — operator pause points

**Purpose:** Separate what an **automated agent** can do from steps that **require you** (keys, spend, legal gates, infrastructure). Use this alongside [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md) and [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md).

---

## PAUSE 0 — Endpoint warm and env correct (before any `eval-*` or ingest smoke)

| Owner | Action |
|--------|--------|
| **You** | Ensure `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`, and `FIREWORKS_API_KEY` / `EXTRACTION_API_KEY` match a **running** deployment (Fireworks scale-from-zero can return `DEPLOYMENT_SCALING_UP` / 503 for several minutes). Optionally wake the deployment from the Fireworks console, or wait and re-run. |
| **You** | Confirm `.env` matches the model you intend to compare (wrong deployment id → misleading metrics; see vendor eval record). |
| **Agent / CI** | Run `pnpm ops:eval-extraction-compare -- --export-dir data/phase1-training-export --limit 200 --out data/phase1-training-export/eval-compare-<id>.json` once PAUSE 0 clears. Inner + outer retries for Fireworks cold start are documented in `scripts/eval-extraction-holdout-openai-compatible.ts` (`EXTRACTION_EVAL_MAX_RETRIES`, `EXTRACTION_EVAL_MAX_TRANSIENT_RETRIES`). |

**Unblock:** First `eval:warmup` line completes without `RetryError`, or 5-row smoke produces a report JSON.

---

## PAUSE 1 — Cycle 1 (format / batch-shaped supervision)

| Owner | Action |
|--------|--------|
| **You** | **G1:** Decide that added/changed rows in `train.jsonl` (or a branch export dir) are allowed under [../local/operations/ingestion-fine-tune-data-mitigation-plan.md](../local/operations/ingestion-fine-tune-data-mitigation-plan.md). |
| **You** | Curate or synthesise **200–500** batch-shaped rows (multi-passage user, assistant = valid `[{...}]` only). Merge into the export; keep a one-line note of path + row count in the iteration log. |
| **You** | Approve **Together spend**: `pnpm ops:together-submit-finetune -- --dry-run`, then live submit; paste **job id** into the iteration log. |
| **Agent** | Re-run Step A packaging if training files changed (`pnpm ops:phase2-step-a-together-packaging`). |
| **You** | After weights exist, point `EXTRACTION_*` at the new checkpoint or vendor deployment. |
| **Agent / you** | Run `pnpm ops:eval-extraction-compare` with fixed `--limit 200`; append metrics + decision to the iteration log. |

**Unblock:** Iteration row filled + `eval-compare-cycle-1-*.json` path recorded.

---

## PAUSE 2 — Cycle 2 (`passage_id` grounding)

| Owner | Action |
|--------|--------|
| **You** | Author or approve the **~50-row** eval JSONL and any rubric/script for ID match (see iteration log checklist). |
| **You** | Same G1 + training delta approval as PAUSE 1. |
| **You** | Optional ingest smoke: choose frozen SEP `.txt`, run ingest with `EXTRACTION_*` on the candidate; skim logs for `passage_id` warnings. |

**Unblock:** Custom eval command documented in log + offline compare run.

---

## PAUSE 3 — Cycle 3 (prod failure exemplars)

| Owner | Action |
|--------|--------|
| **You** | **G1 / counsel:** explicit OK to mine and train on redacted production failure traces. |
| **You** | Strip PII; cap exemplars (e.g. ≤100); merge and train with same approval pattern as PAUSE 1. |
| **You** | Ingest smoke only if **offline** `eval-extraction-compare` passes gates vs previous winner. |

**Unblock:** Written clearance reference + iteration metrics.

---

## What “running the lean cycles” means in practice

1. **Measure (automated once endpoint is up)** — golden + remit JSON reports; no training required.
2. **Build (human-gated)** — data + job submission + money.
3. **Learn (shared)** — paste summary into [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md); optional commit of `eval-*.json` if policy allows.

If you want an agent to **re-run eval** after you wake Fireworks, send: “PAUSE 0 cleared — rerun `eval-extraction-compare` limit 200, out path …”.
