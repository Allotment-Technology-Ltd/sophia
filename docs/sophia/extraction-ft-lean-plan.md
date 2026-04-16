# Lean iterative extraction fine-tuning — **plan** (canonical, repo-tracked)

**Not legal advice.** G0/G1: [../local/operations/ingestion-fine-tune-data-mitigation-plan.md](../local/operations/ingestion-fine-tune-data-mitigation-plan.md).

This document is the **revised** lean loop plan (hypothesis → build → measure → learn). It supersedes informal notes: **primary training vendor = Fireworks supervised fine-tuning (SFT)** so you avoid Together → adapter download → local merge → upload for each iteration. **Together** remains documented as a **legacy** path in [../local/operations/together-lora-phase2-runbook.md](../local/operations/together-lora-phase2-runbook.md).

**Companion docs:** [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md) (frozen eval commands), [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md) (append-only rows), [extraction-ft-lean-pause-points.md](./extraction-ft-lean-pause-points.md) (human vs agent), [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) (deploy + **SFT addendum**).

---

## Principles

- **One primary hypothesis per iteration** — falsify or support a single claim on `schemaPassRate` / `subsetTextMatchRate` (see baseline doc).
- **Smallest build** — data deltas and hyperparam nudges; cap rows and job cost per sprint.
- **Measure before merge** — same two-slice eval (`pnpm ops:eval-extraction-compare`, `--limit 200`).
- **Learn in writing** — iteration log subsection per cycle.

```mermaid
flowchart LR
  hypothesize[Hypothesize]
  build[Build_small_FT_Fireworks_SFT]
  measureFast[Measure_fast_eval]
  decide[Learn_decide]
  hypothesize --> build --> measureFast --> decide
  decide -->|iterate| hypothesize
  decide -->|ship| deploy[Deploy_FT_model_Fireworks]
  deploy --> measureFast
```

---

## Contract lock (unchanged)

Training **messages** must match production: same folded system + user shape as ingest (`EXTRACTION_SYSTEM` / `EXTRACTION_USER`, `scripts/convert-phase1-jsonl-to-together-chat.ts` defaults), same JSON-array semantics (`parseExtractionJsonFromModelResponse`). Any prompt change invalidates cross-run comparison until you bump **dataset / manifest fingerprints** in the eval report notes.

---

## Primary build path — Fireworks SFT

| Step | Owner | Action |
|------|--------|--------|
| **A** | Agent / you | After JSONL changes: `pnpm ops:phase2-step-a-together-packaging -- --export-dir data/phase1-training-export` (still named “together” — output is **generic chat JSONL**). |
| **B** | You | Pick a Fireworks **Tunable** `--base-model` (`firectl model get -a fireworks <ID>` → `Tunable: true`). |
| **C** | You + agent | `pnpm ops:fireworks-submit-sft -- --dry-run …` then live submit with **`FIREWORKS_API_KEY`** and account id (`FIREWORKS_ACCOUNT_ID` or infer from `EXTRACTION_MODEL`). Optional: `--write-report data/phase1-training-export/fireworks-sft-job-submitted.json`. |
| **D** | You | Wait for job completion in Fireworks UI or `firectl sftj get …`; then **`firectl deployment create <output-model-slug>`** (see [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md)). |
| **E** | Agent / you | Set `EXTRACTION_MODEL` to the new **deployment** id; run `pnpm ops:eval-extraction-compare`. |

**Warm start:** For a second iteration on top of a prior Fireworks LoRA, Fireworks supports `warmStartFrom` / `firectl sftj create --warm-start-from …` (see vendor docs). Extend `scripts/fireworks-submit-sft.ts` when you need it.

**Legacy path:** Together LoRA + merged tarball + `firectl model create` — [together-lora-phase2-runbook.md](../local/operations/together-lora-phase2-runbook.md).

---

## Metric stack (unchanged)

Canonical script: `scripts/eval-extraction-holdout-openai-compatible.ts`. Gates: **`schemaPassRate`**, **`subsetTextMatchRate`** (golden), remit slice for breadth; **`--mismatch-diagnostics`**; latency p50/p95. Wrapper: `pnpm ops:eval-extraction-compare`.

---

## Cycles 1–3 (hypotheses)

Same scientific content as before; only **Step B/C** swap from Together to Fireworks:

1. **Format / batch-shaped JSON** — batch supervision; measure schema on golden + text match on remit.
2. **`passage_id` grounding** — small hand eval JSONL + optional ingest smoke.
3. **Prod failure exemplars** — G1-cleared; offline eval before ingest smoke.

Detail checklists: [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md).

---

## Agent vs human — todo checklist

Use this as Cursor / operator todos (copy into a session or issue).

### Setup (once per export vintage)

- [ ] Confirm `manifest.json` fingerprints documented in [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md).
- [ ] Confirm Fireworks account + API key; infer or set `FIREWORKS_ACCOUNT_ID`.

### Every iteration

- [ ] **Human:** Write one-paragraph hypothesis (which metric, which slice).
- [ ] **Human:** G1 approval for any training row change.
- [ ] **Agent:** `pnpm ops:phase2-step-a-together-packaging` after export edits.
- [ ] **Human:** Choose `--base-model` (Tunable) and `--output-model` slug.
- [ ] **Agent:** `pnpm ops:fireworks-submit-sft -- --dry-run` with correct files; **Human:** approve spend → remove `--dry-run`.
- [ ] **Human:** Create deployment when job completes; paste deployment id / model id into iteration log.
- [ ] **Human:** Wake or wait for scale-from-zero if needed.
- [ ] **Agent:** `pnpm ops:eval-extraction-compare -- --limit 200 --out …/eval-compare-<iter>.json`.
- [ ] **Human:** Decision (ship / iterate / stop) + next hypothesis in iteration log.

### Optional engineering (separate PRs)

- [ ] Telemetry: `extraction_inner_array_recoveries` (or similar) for format salvage vs parse.
- [ ] Extend `fireworks-submit-sft.ts` with `--warm-start-from`, region, W&B flags as needed.

---

## Artefacts

- Versioned **`eval-compare-*.json`** under `data/phase1-training-export/` (commit if policy allows).
- **`fireworks-sft-job-submitted.json`** (from `--write-report`) for job id + dataset ids.
- Together lineage (legacy): `artifact-ft-*.json`, Together job JSON — [phase2-step-d-artifacts-runbook.md](../local/operations/phase2-step-d-artifacts-runbook.md).
