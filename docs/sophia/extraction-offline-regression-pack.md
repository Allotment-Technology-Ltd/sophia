# Extraction offline regression (no deploy loop)

This ties together **prod-shaped failures**, **batch-shaped stress**, and **ingest log smoke** so you can iterate extraction models without shipping every candidate.

## 1. Frozen “prod regression” JSONL (Step A row shape)

- **Committed synthetic pack (CI + local):** `data/phase1-training-export/fixtures/eval_prod_regression_pack.jsonl`  
  Same fields as `golden_holdout.jsonl` (`source_url`, `input`, `label` claim object). URLs use `https://regression.example.invalid/…` so they never resolve.
- **Contract tests:** `src/lib/server/ingestion/extractionEvalJsonlContract.test.ts` — every fixture line must parse and satisfy `ExtractionClaimSchema` on `label`.
- **Eval (needs `EXTRACTION_*` in env):**

```bash
pnpm ops:eval-extraction-prod-regression-pack
# equivalent:
pnpm exec tsx --env-file=.env scripts/eval-extraction-holdout-openai-compatible.ts -- \
  --jsonl data/phase1-training-export/fixtures/eval_prod_regression_pack.jsonl \
  --limit 50 \
  --out data/phase1-training-export/eval-prod-regression-pack-report.json
```

### Curating real prod rows (G1)

Prod-derived rows must be **cleared and redacted** before landing in git. Neon does not store raw `[JSON_FAIL]` model output on `ingest_runs`; use telemetry to find **which runs** had repair pressure, then rebuild `input` from an approved snapshot (or re-fetch) and hand-redact.

```bash
pnpm ops:neon-extraction-json-repair-candidates -- --limit=80 --days=180
```

Each output line is a manifest record (`run_id`, `source_url`, failure counts). Append new JSONL rows to a **local-only** file (or extend the synthetic pack after review), re-run the Vitest contract checks, then `pnpm ops:eval-extraction-prod-regression-pack` with `--jsonl` pointing at your file.

## 2. Batch-shaped offline eval (multi-`<passage>` stress)

- **Fixture:** `data/phase1-training-export/fixtures/eval_batch_format_stress.jsonl` — one row, five `<passage>` blocks (matches `renderPassageBatch` / ingest batch shape).
- **Folded into compare:** `pnpm ops:eval-extraction-compare` runs this slice automatically when that file exists under `--export-dir` (see `summary.batchStress` in the combined JSON).

Single-slice eval:

```bash
pnpm exec tsx --env-file=.env scripts/eval-extraction-holdout-openai-compatible.ts -- \
  --jsonl data/phase1-training-export/fixtures/eval_batch_format_stress.jsonl \
  --limit 20 \
  --mismatch-diagnostics
```

## 3a. Full article locally — **Stage 1 only** (`--stop-after-extraction`)

Run the real segmentation + multi-batch extraction path (same as prod), then **exit before relations** so you can iterate on `EXTRACTION_*` / JSON behaviour without paying for Stages 2–6.

### Frozen SEP baseline: **Descartes’ Epistemology**

Use the same entry that has already surfaced extraction pain (long SEP structure, batching / JSON repair pressure), so regressions are meaningful before you move to a novel source.

1. **Fetch** (SEP text is not committed under `data/sources/` — copyright; fetch once per machine):

```bash
pnpm ops:fetch-sep-descartes-epistemology-baseline
```

2. **Extract only** (Stage 1, then exit):

```bash
pnpm ops:ingest-descartes-epistemology-extract-only
```

That expects `data/sources/descartes-epistemology.txt` (slug from the SEP title in `fetch-source.ts`). If `fetch-source` prints a different filename, use that path instead.

**Already ingested in Surreal?** A source with `ingestion_log` status `complete` is skipped unless you pass **`--force-stage extracting`** (the `pnpm ops:ingest-descartes-epistemology-extract-only` script includes that so baseline re-runs always execute Stage 1 again).

### Additional SEP baselines (issue-rich; not in phase1 65-URL cohort)

Same pattern as Descartes: **fetch once**, then **`extract-only`** or **`extract-only:fresh`** (`INGEST_FRESH_EXTRACTION=1` clears partial extraction checkpoints before Stage 1 — see `scripts/ingest.ts` usage). Slugs below are what `fetch-source.ts` writes today (title-derived); if the SEP title changes, re-run fetch and adjust paths.

| Entry | Fetch | Stage 1 only | Cold Stage 1 |
|--------|--------|--------------|----------------|
| [Descartes’ Epistemology](https://plato.stanford.edu/entries/descartes-epistemology/) | `pnpm ops:fetch-sep-descartes-epistemology-baseline` | `pnpm ops:ingest-descartes-epistemology-extract-only` | `pnpm ops:ingest-descartes-epistemology-extract-only:fresh` |
| [Disagreement](https://plato.stanford.edu/entries/disagreement) | `pnpm ops:fetch-sep-disagreement-baseline` | `pnpm ops:ingest-disagreement-extract-only` | `pnpm ops:ingest-disagreement-extract-only:fresh` |
| [Hume](https://plato.stanford.edu/entries/hume) | `pnpm ops:fetch-sep-hume-baseline` | `pnpm ops:ingest-hume-extract-only` | `pnpm ops:ingest-hume-extract-only:fresh` |
| [Spinoza](https://plato.stanford.edu/entries/spinoza) | `pnpm ops:fetch-sep-spinoza-baseline` | `pnpm ops:ingest-spinoza-extract-only` | `pnpm ops:ingest-spinoza-extract-only:fresh` |

Expected `data/sources/` files after fetch:

- Descartes’ Epistemology → `descartes-epistemology.txt`
- Disagreement → `disagreement.txt`
- David Hume → `david-hume.txt` (script names use **hume**; path is **david-hume**)
- Baruch Spinoza → `baruch-spinoza.txt` (script names use **spinoza**; path is **baruch-spinoza**)

For any other SEP, use a real path (do not paste angle brackets; zsh treats `<...>` as redirection):

```bash
pnpm exec tsx --env-file=.env scripts/ingest.ts data/sources/MY_SLUG.txt --force-stage extracting --stop-after-extraction
```

Checkpoints are written like a normal ingest (`savePartialResults`: Neon when `INGEST_ORCHESTRATION_RUN_ID` + `DATABASE_URL` are set, otherwise `data/ingested/<slug>-partial.json`). **Resume** the same path **without** the flag to continue into relations.

- **JSON repair vs `EXTRACTION_*`:** When **`EXTRACTION_BASE_URL`** and **`EXTRACTION_MODEL`** are set, **`json_repair` defaults to the same OpenAI-compatible deployment as extraction** (so a tuned model can fix its own malformed JSON). Set **`INGEST_JSON_REPAIR_USE_EXTRACTION_ENDPOINT=0`** to use the catalog Gemini / Restormel repair chain instead. Pins **`INGEST_PIN_PROVIDER_JSON_REPAIR`** / **`INGEST_PIN_MODEL_JSON_REPAIR`** also skip the extraction mirror.
- **Gemini / JSON repair (`vertex` catalog):** When repair is **not** routed via `EXTRACTION_*`, ingest uses **`GOOGLE_AI_API_KEY`** (Google AI Studio) for catalog `vertex` stages. If the key lives under another name, `loadServerEnv()` copies **`GEMINI_API_KEY`**, **`GOOGLE_GENAI_API_KEY`**, or **`google_AI_API_KEY`** / **`Google_AI_API_KEY`** into `GOOGLE_AI_API_KEY` when the latter is unset. If the API still returns **`API_KEY_SERVICE_BLOCKED`**, open Google Cloud Console → APIs & Services → **Credentials** → that API key → **API restrictions** and allow **Generative Language API** (the `generativelanguage.googleapis.com` endpoint), not only Vertex AI.

- **Surreal:** Required for a typical local run (ingestion log). To mirror `--stop-before-store`, set **`INGEST_ORCHESTRATION_RUN_ID`** + **`DATABASE_URL`** so the script skips Surreal for these phases and persists staging to Neon only.
- If Stage 1 was **already complete in this process** (partial checkpoint) and you re-invoke with `--stop-after-extraction` **without** `--force-stage extracting`, the script **warns and continues** into Stage 2 (so you do not get stuck). Use **`--force-stage extracting`** for a full re-extract (required when Surreal says the source is **`complete`** and you still want to benchmark extraction again).

## 3. Ingest smoke on a frozen SEP (baseline vs candidate)

Closest cheap proxy to prod: same **slug / checkpoint / URLs**, swap only `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`, and keys; capture full stdout/stderr twice.

1. Prefer a **fixed** source (e.g. Descartes’ Epistemology or the Disagreement / Hume / Spinoza scripts above: same `data/sources/<slug>.txt` + checkpoints) and document it in your run notes.
2. Run `scripts/ingest.ts` (or your usual ingest entrypoint) against **baseline** env; save log → `baseline.log`.
3. Repeat with **candidate** env; save log → `candidate.log`.
4. Compare structured counts:

```bash
pnpm exec tsx scripts/extraction-ingest-log-metrics.ts baseline.log
pnpm exec tsx scripts/extraction-ingest-log-metrics.ts candidate.log
```

Signals: `json_fail_lines`, `extraction_repair_ok_lines`, `extraction_ok_lines`, `batch_split_lines`, `ingest_model_json_parse_failed_mentions`. Expect small absolute numbers on a 1–2 batch smoke; look for **regressions** (more JSON fails / splits vs baseline).

## Surreal

Surreal does not expose the same completed-run telemetry as Neon `report_envelope.timingTelemetry`. For failure mining, prefer **Neon manifest → redacted JSONL**; Surreal remains the runtime store during ingest.
