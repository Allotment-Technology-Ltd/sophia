# ML utilities — Phase 2 extraction (local artifacts)

These scripts run **outside** the main `pnpm` TypeScript pipeline (Python + GPU RAM). Use a clean venv or Colab.

## Training + merge paths (which artifact do you have?)

| Path | When to use | You need |
|------|----------------|----------|
| **Fireworks SFT (preferred lean loop)** | You train **on Fireworks** from chat JSONL (`pnpm ops:phase2-step-a-together-packaging` → `train.together.jsonl`). Output is a Fireworks **fine-tuned model id**; deploy with `firectl deployment create` — see [`docs/sophia/extraction-fireworks-deploy.md`](../../docs/sophia/extraction-fireworks-deploy.md) SFT addendum and `pnpm ops:fireworks-submit-sft`. | **No** Together tarball; **no** local `merge_peft_lora.py` unless you export weights for another host. |
| **Together merged tarball** (legacy job `ft-d95bacfb-6f78`) | Together UI / checkpoints delivered a **full merged** archive (`config.json`, sharded `*.safetensors`, tokenizers). You upload that tree to Fireworks (or another host) **without** running `merge_peft_lora.py`. | Extracted HF directory; see artifact table in [`docs/sophia/extraction-fireworks-deploy.md`](../../docs/sophia/extraction-fireworks-deploy.md). |
| **Local `merge_peft_lora.py`** | You only have a **PEFT adapter** tarball, need a **reproducible** merge from adapter + pinned base, or you want to avoid trusting vendor merge bytes. | Same HF **base model id** as the fine-tune (`mistralai/Mistral-7B-Instruct-v0.2` for the completed spike); adapter dir unpacked from Together. |

**Naming / reproducibility:** keep directories and sidecars traceable — include Together **`job_id`**, archive **date**, and export **`cohortFingerprintSha256_16`** / **`goldenFingerprintSha256_16`** from [`data/phase1-training-export/manifest.json`](../../data/phase1-training-export/manifest.json). The repo sidecar [`data/phase1-training-export/artifact-ft-d95bacfb-6f78.json`](../../data/phase1-training-export/artifact-ft-d95bacfb-6f78.json) records hashes and lineage for the shipped job.

**Pinning the HF base (local merge only):** `transformers` / `huggingface_hub` resolve `mistralai/Mistral-7B-Instruct-v0.2` to the latest compatible revision on the Hub. For strict reproducibility, cache a snapshot (e.g. `HF_HUB_OFFLINE=1` with a local clone) or extend `merge_peft_lora.py` with an optional `--revision` passed through to `from_pretrained` once you record the target commit in your ops log.

## Merge LoRA → bf16 (local Peft merge — adapter-only path)

1. Download the adapter + base config from Together (or your run output) into a directory.
2. Install: `pip install torch transformers peft accelerate` (versions must match your stack).
3. Run:

```bash
python scripts/ml/merge_peft_lora.py \
  --base mistralai/Mistral-7B-Instruct-v0.2 \
  --adapter ./my-lora-adapter \
  --out ./merged-bf16
```

Use **`v0.2`** when the Together fine-tune used `mistralai/Mistral-7B-Instruct-v0.2` (see `data/phase1-training-export/together-finetune-job-submitted.json`).

## Step D artifact sidecar (hashes + lineage)

Refresh [`data/phase1-training-export/artifact-ft-d95bacfb-6f78.json`](../../data/phase1-training-export/artifact-ft-d95bacfb-6f78.json) after re-downloading tarballs or re-extracting the HF tree:

```bash
pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export
```

Optional: upload **only the JSON sidecar** to a private GCS URI (large weights stay operator-managed; use IAM + lifecycle on the bucket for tarballs):

```bash
export PHASE2_ARTIFACT_GCS_URI=gs://your-bucket/path/artifact-ft-d95bacfb-6f78.json
pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export
```

Requires `gsutil` on `PATH`. Clearing the env var skips upload.

## Quantization / serving (pick one)

- **Fireworks (managed, scale-to-zero):** upload merged HF dir **or** LoRA addon with `firectl`, then create an on-demand deployment. Prefer **vendor-documented** import and runtime precision; skip hand-rolled AWQ/GPTQ unless their docs require it for your deployment mode. Step-by-step: [`docs/sophia/extraction-fireworks-deploy.md`](../../docs/sophia/extraction-fireworks-deploy.md). Helpers: `scripts/fireworks-extraction-deploy.sh <slug> <dir>`, `scripts/fireworks-extraction-eval-env.sh` (`firectl model create` uses a **short slug**, not `accounts/.../models/...`).
- **vLLM + AWQ (self-host):** optional path — [`docs/sophia/extraction-vllm-awq.md`](../../docs/sophia/extraction-vllm-awq.md). Pin **vLLM** and quant tool versions at install time; serve with documented OpenAI entrypoint flags.
- **Other hosts:** follow the host’s documented weight import. Avoid ad-hoc `bitsandbytes` / `load_in_8bit` checkpoint dumps unless the host explicitly supports them.

## Legal / ops

Do not upload weights or logs until **`pause-after-vendor-ft`** is cleared — see [`../../docs/sophia/ingestion-extraction-phase2-pause-after-vendor-ft.md`](../../docs/sophia/ingestion-extraction-phase2-pause-after-vendor-ft.md).

Training data must remain **G1-cleared** per [`../../docs/local/operations/ingestion-fine-tune-data-mitigation-plan.md`](../../docs/local/operations/ingestion-fine-tune-data-mitigation-plan.md).
