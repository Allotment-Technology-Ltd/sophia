# Phase 2 — `pause-after-g0` sign-off (engineering record)

**Not legal advice.** This records the **PAUSE** gate after **`g0-export`** and before **`g1-shards`** (mitigation plan §4 / §8 / §9 M9.23).

## Status

| Check | Outcome |
|-------|---------|
| **G0 vs volume gate** | **Green** — Phase 0 **§0.1** / handover: **~7.8k** schema-valid non-golden claim lines (Phase-1-shaped export, `--no-stratified`) + **723** golden holdout (2026-04-14 baseline); stratified default splits the non-golden pool without changing cohort rules. |
| **Golden leakage** | **Pass** — exporter assigns golden URLs only to `golden_holdout` / `golden_holdout.<provider>.jsonl`; verify anytime with **`pnpm ops:check-training-export-leakage -- --export-dir=<dir>`** (reads `train*.jsonl`, `validation*.jsonl`, `test*.jsonl` only). |
| **Schema freeze (extraction labels)** | **`ExtractionClaimSchema`** in **`src/lib/server/prompts/extraction.ts`** — pin by git ref in training runbooks; JSONL manifest points to the same path. |
| **Proceed to `g1-shards`** | **Approved (2026-04-13)** — use **`--g1-allow-extraction-prefix=`** (repeatable) and/or **`--g1-shard-by-provider`** on **`pnpm ops:phase1-export-training-jsonl`** so ToS / policy buckets do not mix without manifest tagging. |

## Operator notes

- **Do not** merge pre-relabel and post-relabel JSONL in one fine-tune directory without explicit manifest fields (**M9.23**). The export manifest lists `neon_run_ids`, `extraction_model_by_run_id`, and (when used) G1 prefix / shard policies.
- **Full-volume refresh:** `pnpm ops:phase1-export-training-jsonl -- --days=90 --limit=5000 --out-dir=data/phase1-training-export` then `pnpm ops:check-training-export-leakage -- --export-dir=data/phase1-training-export`.

## Prior gates

- **`pause-after-validation`:** [`ingestion-extraction-phase2-signoff.md`](./ingestion-extraction-phase2-signoff.md)
