# Phase 2 — `pause-after-g0` sign-off (engineering record)

**Not legal advice.** This records the **PAUSE** gate after **`g0-export`** and before **`g1-shards`** (mitigation plan §4 / §8 / §9 M9.23).

## Status

| Check | Outcome |
|-------|---------|
| **G0 vs volume gate** | **Green** — Phase 0 **§0.1** / handover: **~7.8k** schema-valid non-golden claim lines (Phase-1-shaped export, `--no-stratified`) + **723** golden holdout (2026-04-14 baseline); stratified default splits the non-golden pool without changing cohort rules. |
| **Golden leakage** | **Pass** — exporter assigns golden URLs only to `golden_holdout` / `golden_holdout.<provider>.jsonl`; verify anytime with **`pnpm ops:check-training-export-leakage -- --export-dir=<dir>`** (reads `train*.jsonl`, `validation*.jsonl`, `test*.jsonl` only). |
| **Schema freeze (extraction labels)** | **`ExtractionClaimSchema`** in **`src/lib/server/prompts/extraction.ts`** — pin by git ref in training runbooks; JSONL manifest points to the same path. |
| **Proceed to `g1-shards`** | **Approved (2026-04-13)** — use **`--g1-policy-cleared`** (see table below) and/or **`--g1-allow-extraction-prefix=`**, plus optional **`--g1-shard-by-provider`**, on **`pnpm ops:phase1-export-training-jsonl`** so policy buckets do not mix without manifest tagging. |

## Policy-cleared extraction providers (G1)

Organisation policy for **supervision-eligible** `stage_models.extraction` prefixes (also exported as **`POLICY_CLEARED_EXTRACTION_PREFIXES`** in `scripts/export-phase1-training-jsonl.ts`):

| Policy intent | Prefix(es) in telemetry | Notes |
|---------------|-------------------------|--------|
| **Vertex** | `vertex/` | Vertex AI–hosted models, **including Gemini** (`vertex/gemini-…`). |
| **Gemini** | `vertex/` and, if used, `google/` | Gemini is typically logged under **`vertex/`**; some routes may use **`google/`** for Google AI–hosted models — both prefixes are in the preset. |
| **Mistral** | `mistral/` | |
| **DeepSeek** | `deepseek/` | |

**One-shot export (policy preset + optional sharding):**
`pnpm ops:phase1-export-training-jsonl -- --days=90 --limit=5000 --out-dir=data/g1-policy --g1-policy-cleared --g1-shard-by-provider`

## Operator notes

- **Do not** merge pre-relabel and post-relabel JSONL in one fine-tune directory without explicit manifest fields (**M9.23**). The export manifest lists `neon_run_ids`, `extraction_model_by_run_id`, and (when used) G1 prefix / shard policies.
- **Full-volume refresh:** `pnpm ops:phase1-export-training-jsonl -- --days=90 --limit=5000 --out-dir=data/phase1-training-export` then `pnpm ops:check-training-export-leakage -- --export-dir=data/phase1-training-export`.

## Prior / next gates

- **`pause-after-validation`:** [`ingestion-extraction-phase2-signoff.md`](./ingestion-extraction-phase2-signoff.md)
- **Next:** [`ingestion-extraction-phase2-pause-after-g1.md`](./ingestion-extraction-phase2-pause-after-g1.md) (after G1 export + manifest audit)
