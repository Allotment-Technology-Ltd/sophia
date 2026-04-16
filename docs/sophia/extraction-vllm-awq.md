# Optional self-host: vLLM + AWQ (Phase 2 extraction weights)

**Purpose:** Document the **second hosting option** from the alternative Phase 2 plan: serve **merged bf16** (or AWQ-quantized) Mistral-7B-class weights with **vLLM**’s OpenAI-compatible server, instead of (or as failover to) Fireworks.

**Not legal advice.** Self-hosted inference shifts **security, residency, and subprocessors** to you — align with [`docs/sophia/ingestion-extraction-phase2-pause-after-vendor-ft.md`](./ingestion-extraction-phase2-pause-after-vendor-ft.md) and [`docs/local/operations/ingestion-fine-tune-data-mitigation-plan.md`](../local/operations/ingestion-fine-tune-data-mitigation-plan.md).

**Primary path for this repo’s spike:** Fireworks + merged HF weights — see [`docs/sophia/extraction-fireworks-deploy.md`](./extraction-fireworks-deploy.md). Only follow this doc if you explicitly need vLLM (cost, EU-only GPU, custom batching, etc.).

---

## 1. Prereqs

- **Merged bf16 weights** on disk (same tree as Fireworks: `config.json`, sharded `*.safetensors`, tokenizer files). Source options:
  - Extract Together’s **merged** tarball (see artifact table in [`extraction-fireworks-deploy.md`](./extraction-fireworks-deploy.md)), or
  - Run [`scripts/ml/merge_peft_lora.py`](../../scripts/ml/merge_peft_lora.py) from the **LoRA adapter** + pinned base (`--revision` recommended for reproducibility).
- **Lineage:** record the job and hashes in [`data/phase1-training-export/artifact-ft-d95bacfb-6f78.json`](../../data/phase1-training-export/artifact-ft-d95bacfb-6f78.json) (refresh with `pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export`).

---

## 2. Pin versions (record at install time)

vLLM and AWQ toolchains move quickly. **Write down** the exact versions you used in your ops log (and ideally in a `requirements-vllm-awq.txt` next to the run):

| Component | What to pin |
|-----------|----------------|
| **vLLM** | `pip show vllm` → copy **Version** (or install with `vllm==x.y.z`). |
| **PyTorch / CUDA** | Match vLLM’s supported matrix for your GPU driver. |
| **AWQ implementation** | e.g. **AutoAWQ**, **llm-compressor**, or vendor doc you follow — pin package version and CLI invocation. |

Re-validate latency and schema pass rate after any upgrade.

---

## 3. Produce AWQ weights (outline)

Exact flags depend on your chosen AWQ tool. At a high level:

1. Start from the **bf16 merged** HF directory (not bitsandbytes 8-bit saves).
2. Run your tool’s **calibration** step using **representative prompts** (e.g. a stratified slice of claim-level `input` text from G1-cleared export — do not mix vintages; see mitigation plan).
3. Emit an **AWQ model directory** in the format your **vLLM** build expects (tool docs usually specify layout and `quant_config`).

**Skip:** ad-hoc `load_in_8bit` / `bitsandbytes` serialization unless vLLM’s own docs describe that path for your version.

---

## 4. Serve with vLLM (OpenAI-compatible)

Use the **official** entrypoint for your pinned vLLM version, for example (pseudo-invocation — replace with current docs):

```bash
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/merged-or-awq-hf-dir \
  --quantization awq \
  --host 0.0.0.0 \
  --port 8000
```

- If you serve **bf16 only**, **omit** `--quantization awq` and size GPUs accordingly.
- Point Sophia eval or ingest at **`http://<host>:8000/v1`** (or the path your build documents) and set **`EXTRACTION_MODEL`** to the **model name** your server exposes.

**Message format:** training used **folded system** (`user-assistant-folded-system` in Together metadata). If the served stack rejects separate `system` messages, keep eval/ingest aligned with [`scripts/eval-extraction-holdout-openai-compatible.ts`](../../scripts/eval-extraction-holdout-openai-compatible.ts) defaults or set `EXTRACTION_EVAL_FOLD_SYSTEM` as documented in the Fireworks deploy guide.

---

## 5. Verification

- Smoke: one completion from the OpenAI-compatible `/chat/completions` endpoint.
- Repo eval: `pnpm ops:eval-extraction-holdout-openai-compatible` with **`EXTRACTION_BASE_URL`** / **`EXTRACTION_MODEL`** aimed at vLLM.
- Compare **`schemaPassRate`** and latency p50/p95 to archived Fireworks runs in [`docs/local/operations/extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md).

---

## 6. Rollback

- Keep the **bf16 merged** tree (or tarball) until AWQ quality is proven.
- Revert **`EXTRACTION_*`** to the previous Fireworks deployment or baseline provider.
