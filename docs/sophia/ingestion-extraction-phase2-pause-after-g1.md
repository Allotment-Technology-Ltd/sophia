# Phase 2 — `pause-after-g1` sign-off (engineering record)

**Not legal advice.** This records the **PAUSE** gate after **`g1-shards`** and before billable **GCP** work (**`gcp-day0`**) per Phase 2 plan and mitigation **§4 / §9 M9.23**.

## Status

| Check | Outcome |
|-------|---------|
| **Manifest + provenance** | **Pass (engineering)** — JSONL exports from **`pnpm ops:phase1-export-training-jsonl`** include **`manifest.json`** with `generatedAt`, `phase`, `cohort`, `counts`, `provenance.neon_run_ids`, `provenance.extraction_model_by_run_id`, and (when used) G1 fields (`g1_allow_extraction_prefix`, `g1_policy_cleared_*`, `g1_shard_by_extraction_provider`). Spot-check: **`pnpm ops:audit-training-export-manifest -- --export-dir=<dir>`**. |
| **No undeclared vintage mix** | **Operator responsibility** — do not combine pre-relabel / post-relabel shards in one training directory without manifest lineage (**M9.23**). Policy-cleared preset: **`--g1-policy-cleared`** (`POLICY_CLEARED_EXTRACTION_PREFIXES` in exporter). |
| **Shard counts vs plan** | **Recorded at export time** — `manifest.counts` must align with line counts in shipped `*.jsonl` (re-run export after cohort changes; compare totals to mitigation §1 orientation). |
| **Golden leakage** | **Pass** — **`pnpm ops:check-training-export-leakage -- --export-dir=<dir>`** on the same directory used for train/val/test. |
| **Proceed to `gcp-day0`** | **Approved (2026-04-13)** — Terraform spike path **`infra/gcp-phase2-spike/`**; remote state / CI: [`REMOTE_STATE_AND_CI.md`](../../infra/gcp-phase2-spike/REMOTE_STATE_AND_CI.md). **No** first GPU training job until **`pause-after-gcp`** per plan. |

## Operator checklist (before first `terraform apply` with GPU)

- [ ] Billing alert / budget envelope for **`sophia-ai-spike`** (or chosen project) per programme (~£500 / Phase 2 &lt;£200 target in technical review).
- [ ] Terraform backend migrated if using GCS state (see REMOTE_STATE_AND_CI).
- [ ] Quota / region choices match **technical review §B** (e.g. L4 eu-west4 train, eu-west2 vLLM — adjust to match landed `terraform.tf`).

## Prior gates

- **`pause-after-g0`:** [`ingestion-extraction-phase2-pause-after-g0.md`](./ingestion-extraction-phase2-pause-after-g0.md)
