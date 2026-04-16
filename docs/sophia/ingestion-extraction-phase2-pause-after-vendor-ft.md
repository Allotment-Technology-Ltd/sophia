# Phase 2 — `pause-after-vendor-ft` sign-off (alternative Together / managed inference path)

**Not legal advice.** Engineering PAUSE after [`pause-after-g1`](./ingestion-extraction-phase2-pause-after-g1.md) and **before** first billable use of **third-party fine-tune or inference hosts** (Together AI, Fireworks AI, Hugging Face Hub model uploads, Vast.ai, or similar) when following the **alternative Phase 2** plan (Together LoRA → merge/quantize → OpenAI-compatible serving). Canonical GCP-first Phase 2 remains gated by **`gcp-day0`** / **`pause-after-gcp`** in [`ingestion-extraction-phase2-pause-after-g1.md`](./ingestion-extraction-phase2-pause-after-g1.md).

## Why this gate exists

- **Mitigation plan** ([`../local/operations/ingestion-fine-tune-data-mitigation-plan.md`](../local/operations/ingestion-fine-tune-data-mitigation-plan.md)) still governs **G1-cleared** training data only; **new** processors need explicit **ToS / DPA / subprocessors** review (Together, inference host, optional HF public weights).
- **Weight upload** (e.g. public Hugging Face repos) is a **separate disclosure** decision from Neon export sign-off.
- **Self-hosted inference** (Vast.ai, home GPU) shifts **security and data-residency** responsibility to the operator.

## Status

| Check | Outcome |
|-------|---------|
| **G1 export unchanged** | Re-run **`pnpm ops:phase1-export-training-jsonl -- --g1-policy-cleared`** (and audits) into a **frozen directory** before any vendor upload. |
| **Counsel / procurement** | **Operator** — record approval (or explicit pilot scope) for: training data **upload** to Together; **inference** provider; optional **HF** publication; **customer content** on rented GPUs if applicable. |
| **Budget / alerts** | Together + inference accounts have **billing alerts** and a **run cap** for pilot fine-tunes (see [`../local/operations/together-lora-phase2-runbook.md`](../local/operations/together-lora-phase2-runbook.md)). |
| **Proceed** | After sign-off: data packaging → Together jobs → eval → merge/quantize → deploy endpoint → set **`EXTRACTION_*`** env for ingest-only routing (see [`.env.example`](../../.env.example)). |

## Prior gates

- **`pause-after-g1`:** [`ingestion-extraction-phase2-pause-after-g1.md`](./ingestion-extraction-phase2-pause-after-g1.md)
- **`pause-after-g0`:** [`ingestion-extraction-phase2-pause-after-g0.md`](./ingestion-extraction-phase2-pause-after-g0.md)
