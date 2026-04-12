# Sophia Ingestion Pipeline — Independent Technical Review

> **Summary:** The 50% wall-time reduction target is technically achievable in principle—replacing a slow, token-heavy LLM extraction call with a fine-tuned smaller model is one of the highest-leverage moves in applied ML—but the 10-day / £500 spike window is razor-thin for the full Phase 2 loop (data prep → train → eval → serve → integrate). The most likely failure modes are not model quality but operational friction: environment setup eating two days, training data being noisier than expected, and cold-start latency on inference erasing gains at p95. This review is deliberately critical: it flags every place the plan is optimistic and gives concrete alternatives where the default path carries high risk.

---

## A) Executive Verdict

**Target plausibility: Medium confidence, conditional.**

Extraction dominating p90 E2E is the necessary precondition—if Phase 0 confirms ≥60% of wall time is in the extraction LLM call, replacing it with a fine-tuned 7–8B model served locally on GPU can plausibly cut that stage by 60–80% (fewer tokens, faster model, no external API round-trip latency). That translates to ~35–50% E2E reduction, which hits the target. However, several conditions must hold simultaneously: the golden dataset must be large enough and clean enough (~500–2000 examples minimum, realistically), the fine-tuned model must match schema validity rates of the current model (not obviously guaranteed), and the inference server must maintain ≥1 warm replica to avoid cold-start overhead. If any one of these fails, you're looking at either quality regression or latency regression—not both improvements at once.

The 10-day window is *just* enough to prove the concept on extraction alone, but only if data export, cleaning, and environment setup are treated as Day 1–3 priorities, not afterthoughts. The £500 credit is tight for training on anything above 13B parameters. **Do not** attempt full fine-tune or anything above 13B in this spike. The plan's instinct to scope to extraction-only is correct and should be held firm against scope creep.

**Unrealistic assumptions to call out explicitly:**
- "Mining from successful runs" assumes production outputs are high-quality ground truth. They are not—they are noisy labels. This is the single biggest data risk.
- The plan does not mention a schema validation step in the training loop, which is critical for JSON-adherent extraction tasks.
- No mention of tokenizer max-length analysis against real philosophical prose inputs—these can be long, and seq-length decisions directly affect VRAM and cost.

---

## B) Phase 2 — GCP Infrastructure

### Training / Fine-Tuning Options

| Option | When to use | Pros | Cons | £500 fit | Notes |
|---|---|---|---|---|---|
| **Vertex AI Custom Training** (managed) | Clean, repeatable runs; team unfamiliar with raw VM management | Managed preemption handling, built-in experiment tracking, integrates with GCS natively, IAM-clean | Slower iteration cycle (job submission overhead); harder to debug mid-run; less flexible env | ⚠️ Marginal — a single A100 40GB job at ~£2.50/hr burns £500 in ~200 hrs; fine for 1–3 runs of a few hours each | Use `us-central1` or `europe-west4` for GPU availability; `europe-west2` has limited L4/A100 stock—**verify before committing** |
| **Vertex AI Workbench** + one-off GPU VM | Interactive iteration, exploratory data cleaning, debugging training loop | Jupyter-native, easy GCS mount, good for short-cycle iteration | Not suited for long unattended training runs; notebook state drift is a risk | ✅ Good for data prep phase (CPU/T4 notebooks are cheap); switch to Custom Training or GCE for the actual fine-tune run | Useful Days 1–4; don't train 7B+ here |
| **Compute Engine GPU VM** (manual) | Maximum control, fastest iteration, preemptible to save cost | Full control of env, can `screen`/`tmux` training, cheapest per-GPU-hour with preemptible | Manual everything: drivers, Python env, crash recovery; preemptible kills jobs without warning | ✅ Best £/experiment ratio — preemptible L4 (~£0.45/hr) or A100 40GB (~£1.20/hr preemptible) fits budget well | **Primary recommendation for training**. Use `europe-west4` (Amsterdam) for GPU stock. Checkpoint to GCS every N steps. |
| **GKE** | Multi-replica serving at scale; existing k8s org | Excellent for prod serving with autoscaling | Major overkill for a 10-day spike; nodepool GPU provisioning adds setup days | ❌ Not for this spike | Revisit in Phase 3/4 if the model goes to prod |
| **Cloud Run GPU** | Serverless GPU inference, zero cold-start if min-instances=1 | No cluster mgmt; OpenAI-compatible server deployable as container | GPU support GA in limited regions/SKUs (L4 only as of early 2026); cold start is 30–90s if min-instances=0; max container memory limits can bite vLLM | ⚠️ Interesting but risky — verify L4 availability in `europe-west2`; do not rely on it as primary | Good fallback if Vertex endpoint quota is the bottleneck |

### Inference Serving Options

| Option | When to use | Pros | Cons | £500 fit | Notes |
|---|---|---|---|---|---|
| **Vertex AI Endpoint** (custom container) | Production-grade serving with autoscaling and monitoring | Managed scaling, health checks, Vertex logging, IAM | Deployment cycle is slow (10–20 min per deploy); min-instances billing even at idle; limited GPU SKUs in `europe-west2` | ⚠️ Marginal — min-instance L4 ~£0.45/hr × 24h = ~£10/day, ~£100 for spike period | Use if you want prod-like serving for the A/B phase |
| **GCE GPU VM running vLLM** | Fast iteration, cost control, manual lifecycle | Cheapest, full control, can stop/start | Manual uptime management; no autoscale; you are the SRE | ✅ Best for spike validation | Stop the VM when not running eval; restart takes ~3 min |
| **Cloud Run GPU** | See above | See above | See above | See above | See above |

### Infrastructure Recommendations

**Primary path (training):** Preemptible GCE GPU VM in `europe-west4` (Amsterdam) — L4 (24GB VRAM) for 7–8B QLoRA, or A100 40GB if you need 13B or full-precision training. Checkpoint adapter weights to GCS every 100 steps. Use a startup script that restores from the latest checkpoint on preemption recovery.

**Primary path (serving/inference):** GCE GPU VM (non-preemptible L4) running vLLM in a Docker container, in `europe-west2` (same region as your Neon/SurrealDB footprint). OpenAI-compatible API on port 8000. Keep it running for the duration of the A/B phase.

**Fallback:** Vertex AI Custom Training for the fine-tune run (if team is uncomfortable with manual VM recovery); Vertex AI Endpoint for serving (if you need the managed health-check behaviour for the A/B eval).

**Region note:** `europe-west2` (London) has historically thin GPU quota for L4 and A100. File quota increase requests immediately (Day 0), and have `europe-west4` as fallback for training. Serving should stay in `europe-west2` to keep egress to Neon/SurrealDB cheap and latency low.

**Egress:** Neon is external (via TLS); SurrealDB if self-hosted on GCE in the same VPC has zero egress cost. The inference VM should be in the same VPC as any internal services. Use Private Service Connect or VPC peering if Neon supports it—otherwise standard TLS egress from `europe-west2` is fine at Sophia's scale.

**Artifact storage:** GCS bucket in `europe-west2` for: training data JSONL, adapter checkpoints, merged model weights, eval outputs. Use Artifact Registry (Docker) for inference container images. Do not store large model weights in Artifact Registry.

---

## C) Phase 2 — How to Train

### Objective: LoRA vs QLoRA vs Full Fine-Tune

**Default pick: QLoRA on a 7–8B model.**

Decision rule: If your golden eval set is <1000 examples, use QLoRA. If >2000 clean examples and you can afford 13B VRAM, try LoRA (non-quantized) for marginally better quality ceiling. Never full fine-tune on £500—a single full-precision 7B training run of 3 epochs would burn the entire budget with little room for iteration.

QLoRA (4-bit NF4 base + BF16 adapter) on a 7–8B model fits comfortably in an L4 (24GB), costs ~£5–15 per training run of 2–3 epochs on a ~1000-example dataset, and leaves room for 10–20 experimental runs within budget.

### Data

**Minimum viable dataset size:** 300–500 clean (input, gold JSON) pairs to see measurable improvement over a zero-shot baseline; 800–1500 for reliable schema adherence; 2000+ for quality that approaches GPT-4-class extraction. Target 1000 as the practical minimum for this spike.

**Label noise risks when mining from production logs:**
- The biggest risk: your current extraction LLM occasionally produces hallucinated claims or schema-invalid outputs that passed downstream validation due to loose checks. These become poisoned training examples.
- Mitigation: Run a schema validator over every candidate training example. Discard any that fail. Apply a secondary deduplication pass (exact + near-duplicate via MinHash) to avoid the model memorising a small cluster of over-represented philosophical texts.
- Do not treat "successfully stored in SurrealDB" as a quality proxy—it only proves schema validity, not faithfulness.
- Flag for legal review: if your corpus includes texts that are in copyright (post-1928 prose, academic papers), the (input text → extracted claims) pairs may constitute derivative works. Get this reviewed before training. Public domain philosophical texts (Plato, Kant, Hume translations pre-1928) are safe. Modern academic philosophy is not.

**De-duplication:** Apply at the input level (source URL or hash of input span) before the train/val/test split. Never let the same source document appear in both train and test. Deduplicate before splitting, not after.

### Hyperparameters (conservative defaults)

| Parameter | Default | Rationale |
|---|---|---|
| Learning rate | 2e-4 | Standard QLoRA default; reduce to 1e-4 if training loss oscillates |
| LR schedule | Cosine with warmup (3–5% steps) | Stable for short runs |
| Epochs | 2–3 | For 1000 examples, 3 epochs = ~3000 steps; watch val loss |
| Batch size | 4 (effective 16 with grad accum ×4) | L4 with 24GB and seq_len 2048 |
| Max seq length | 2048 | Start here; extend to 4096 only if >20% of your inputs are truncated (measure this) |
| LoRA rank | 16 | Conservative; try 32 if quality plateaus |
| LoRA alpha | 32 | 2× rank is a safe default |
| LoRA target modules | `q_proj, v_proj, k_proj, o_proj` | Full attention; add `gate_proj, up_proj` for harder tasks |
| Dropout | 0.05 | Light regularisation |

**Early stopping:** Monitor validation loss and—critically—a task-specific metric: JSON schema pass rate on the held-out val set (run your schema validator as a callback every 50–100 steps). Stop when val schema pass rate stops improving for 2 consecutive checkpoints. Do not rely on training loss alone—it will keep falling while the model overfits to training example formatting quirks.

**What to log:** training loss, val loss, val schema pass rate, val faithfulness score (LLM-as-judge on a 20-example subset), GPU memory utilisation, steps/sec. Log to Weights & Biases (free tier is fine) or Vertex Experiments.

**When to stop burning credit:** If val schema pass rate <85% after epoch 1, the data is too noisy—stop, fix the data, retrain. Do not burn 3 epochs of credit on provably bad data.

---

## D) Phase 2 — Base Model Selection

### Recommended Model Families

**1. Mistral 7B Instruct v0.3 / Mistral-Nemo 12B**
- **Licence:** Apache 2.0 — fully commercial, fine-tuning permitted, no restrictions
- **VRAM:** 7B in 4-bit QLoRA: ~6–8GB active + adapter; fits L4 with room to spare. Nemo 12B: ~12–14GB in 4-bit
- **Fine-tune cost:** ~£5–12 per 3-epoch run at 1000 examples on L4 (QLoRA)
- **Serving latency:** 7B on L4: ~40–80ms/token; at typical extraction output length (300–600 tokens JSON), expect 15–45s per call unoptimised, 8–18s with vLLM continuous batching
- **Quality tradeoff:** Strong instruction following; good JSON adherence with a well-structured system prompt; not the best at very long philosophical prose (>3000 tokens input) without RoPE extension
- **Verdict:** Default choice for this spike. Fastest iteration, cheapest, widest community support

**2. Qwen2.5 7B / 14B Instruct**
- **Licence:** Qwen licence (commercial use permitted for organisations with <100M MAU—Sophia qualifies); fine-tuning permitted
- **VRAM:** 7B QLoRA: ~8GB; 14B QLoRA: ~14–16GB (needs A100 or two GPUs for comfortable training)
- **Fine-tune cost:** 7B similar to Mistral; 14B ~£20–40 per run on A100
- **Serving latency:** Qwen2.5-7B is competitive with Mistral 7B; strong JSON mode adherence out of the box
- **Quality tradeoff:** Excellent structured output quality; strong on longer context (native 32K); notably good at extracting structured data from dense academic text—this is a real differentiator for philosophical prose
- **Verdict:** Strong alternative if JSON adherence is the primary quality concern; prefer the 7B variant within the £500 budget

**3. Llama 3.1 8B Instruct**
- **Licence:** Meta Llama 3 Community Licence — commercial use permitted; fine-tuning permitted; cannot use outputs to train competing foundation models (this does not apply to Sophia's use case)
- **VRAM:** 8B QLoRA: ~8–10GB on L4
- **Fine-tune cost:** Similar to Mistral 7B
- **Serving latency:** Well-optimised in vLLM; good throughput; competitive with Mistral
- **Quality tradeoff:** Strong general instruction following; slightly behind Qwen2.5 on structured extraction in benchmarks; excellent community tooling
- **Verdict:** Safe, well-tested choice; good fallback if Mistral fine-tune quality disappoints

### Models to Avoid

- **GPT-4 / Claude distillation targets:** Using GPT-4 or Claude API outputs as training labels almost certainly violates those providers' ToS. If your production extraction currently runs through one of these, you cannot legally use those outputs as fine-tune training data without explicit permission. **This is a hard blocker if not addressed.** Use only outputs from open models or your own model.
- **Falcon, MPT, older LLaMA 1/2 variants:** Licence complexity, weaker JSON adherence, and inferior instruction tuning relative to the options above. No reason to choose them.
- **Gemma 2 2B:** Too small for complex structured extraction from philosophical prose—schema validity will suffer.

---

## E) Phase 2 — Containers and Software Stack

### Training Stack

**Default pick: Unsloth + TRL + PEFT**

Unsloth provides 2–3× faster QLoRA training and 60–70% VRAM reduction versus vanilla PEFT on the same hardware, which is decisive on a £500 budget. The API is compatible with TRL's `SFTTrainer`, so it's not a lock-in. Axolotl is a good alternative if the team prefers a config-file-driven approach, but it adds an abstraction layer that can obscure debugging. LitGPT is excellent but has a smaller ecosystem for PEFT/LoRA. Hugging Face TRL alone (without Unsloth) is fine but wastes VRAM you need.

**Decision rule:** If any team member has existing Axolotl experience, use it. Otherwise, Unsloth + TRL is the lowest-friction path.

**Training container:**
```
Base: nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04
Python: 3.10 (not 3.12 — several torch/flash-attn deps lag)
Key packages: torch==2.2.*, unsloth, trl, peft, datasets, evaluate, wandb
```

**What NOT to do:**
- Do not build flash-attn from source during a training job. It takes 20–40 minutes and will fail silently on some CUDA/torch version combinations. Use the pre-built wheels from Unsloth's pinned requirements, or install `flash-attn` from the pre-built wheel index.
- Do not use `python:3.12-slim` as a base and layer CUDA on top. Start from the NVIDIA CUDA base image.
- Do not mix `pip install torch` with conda-installed CUDA. Pick one package manager and stick to it for the entire environment.
- Do not train without gradient checkpointing enabled—you will OOM on sequences >1024 tokens without it.
- Do not skip pinning exact versions in your `requirements.txt`. The Unsloth / TRL ecosystem moves fast and breaks between minor releases.

### Inference Stack

**Default pick: vLLM**

vLLM is the clear default for OpenAI-compatible serving of 7–13B models when you control the hardware. It provides continuous batching (critical for throughput when multiple ingestion workers hit the endpoint concurrently), PagedAttention (efficient KV cache), and a drop-in `/v1/chat/completions` endpoint. TGI (Hugging Face Text Generation Inference) is a reasonable alternative but has had more instability in quantized model loading; TensorRT-LLM gives better raw throughput but requires a painful conversion step and ties you to NVIDIA's toolchain; llama.cpp server is excellent for CPU or low-VRAM serving but not the right choice when you have a dedicated GPU.

**Decision rule:** If you're on L4 with a 7–8B model and need OpenAI-compatible serving with concurrent request support, use vLLM. If you need to run on CPU or a GPU with <8GB VRAM (unlikely given the above), use llama.cpp.

**Inference container:**
```
Base: vllm/vllm-openai:v0.4.x (official image — do NOT roll your own)
GPU: L4 or A100 (CUDA 12.1+)
Mount: GCS FUSE or pre-download model weights to persistent disk at startup
```

**What NOT to do:**
- Do not use the `latest` tag on the vLLM image—pin a version. Breaking changes between minor versions are common.
- Do not load the model from GCS at every cold start over the network (10–30 min for a 7B model). Pre-download to a persistent disk image or use a startup script that checks for a local cache first.
- Do not set `--tensor-parallel-size 2` unless you actually have 2 GPUs. It will crash with an unhelpful error on a single-GPU instance.
- Do not skip setting `--max-model-len` explicitly. vLLM will attempt to allocate KV cache for the model's full context length (32K for Qwen2.5), which will OOM on an L4 for a 7B model. Set it to 4096 or 8192 to match your actual input distribution.

---

## F) Integration Realism

### Cleanest Integration Pattern

Since the worker already speaks OpenAI-style chat completions (via Restormel/Keys routing), the cleanest path is **a dedicated base URL for extraction only**, not a sidecar proxy and not a Vertex adapter.

Concretely: add a new entry in your routing config (or env var) for `EXTRACTION_BASE_URL=http://<inference-vm-ip>:8000/v1`. In the extraction stage of `ingest.ts`, route to this URL instead of the external LLM provider. The model name parameter becomes whatever you name your fine-tuned adapter (e.g. `sophia-extract-v1`). No changes to the OpenAI client library, no schema changes to the request/response format.

This is lower-risk than a sidecar proxy because it has fewer moving parts, and lower-risk than the Vertex "OpenAI adapter" pattern because that adapter has additional latency overhead and less control over request forwarding behaviour. The Vertex adapter is useful if you want managed autoscaling to kick in transparently—defer that to Phase 3 if the spike succeeds.

### Cold Start vs Minimum Replicas

This is the most likely way to erase your latency gains, and the plan does not address it adequately.

If `min-replicas=0` (scale-to-zero), a cold start for a 7B vLLM container on GCE takes:
- VM start: 60–90 seconds
- Container pull (if not cached): 2–5 minutes
- Model load from disk: 60–120 seconds (7B in BF16 from persistent disk)
- **Total: 3–7 minutes**

A cold start on a URL that was previously taking 5–15 seconds for extraction completely destroys the latency target and will cause timeouts in the worker. You must run with `min-replicas=1` (one always-warm instance) for the duration of the A/B eval phase. On L4 non-preemptible, that costs ~£0.45/hr × 24h = ~£10.80/day. For a 10-day spike, that's ~£108 just for the inference VM uptime—factor this into the £500 budget.

**Mitigations:**
- Use a persistent disk (not GCS FUSE) for model weights. GCS FUSE cold load of a 7B model is slow.
- Build your Docker image with model weights baked in (a "fat" image) and push to Artifact Registry. This trades image size for startup reliability. A 7B BF16 image is ~15GB—this is acceptable.
- If using Cloud Run GPU: set `--min-instances=1` in the service definition. At idle, it still costs money.

---

## G) Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Training data is poisoned by production LLM ToS violation** — if current extraction uses GPT-4/Claude-class proprietary APIs, those outputs are generally **not** safe to treat as fine-tune targets under typical ToS | High (for this codebase — **confirmed in Neon**, §G.1) | Critical — full legal blocker until relabelled | **Empirical:** extraction is mostly **`openai/gpt-4o-mini`** with a small **Anthropic** tail. Regenerate (input → JSON) with a **ToS-clear** labeler; do not train on mined OpenAI/Anthropic outputs without explicit permission |
| 2 | **Eval leakage** — golden URL set used during data mining bleeds into training set | Medium | High — eval metrics are meaningless; model looks better than it is | De-duplicate training data against golden URL set by exact URL match before any split; run this check automatically in the data pipeline |
| 3 | **Reward hacking / schema gaming** — fine-tuned model learns to output short, syntactically valid but semantically empty JSON | Medium | High — undetectable without faithfulness eval | Add faithfulness scoring (LLM-as-judge on 20–50 examples) to every checkpoint eval; do not use schema pass rate as the sole stop criterion |
| 4 | **Regression on rare source types** — model trained on majority-class texts degrades on minority-class inputs | High | Medium | Stratify training data by source type; include at least 50–100 examples of each minority class; run per-stratum eval metrics |
| 5 | **Multi-turn repair dependency** — current pipeline silently relies on a repair/remediation LLM pass that compensates for extraction errors | Medium | High — quality appears fine in isolation but degrades downstream | Trace the full pipeline graph; confirm what fraction of runs trigger the remediation path |
| 6 | **TPM limit shifts bottleneck, not removes it** — if extraction is fast but other stages become the new bottleneck, E2E gain is less than projected | Medium | Medium | Re-run `[INGEST_TIMING]` profiling after Phase 2 integration |
| 7 | **GPU quota unavailability in europe-west2** — L4 and A100 quota in the London region is thin and often exhausted | High | High (for timeline) | Request quota increases on Day 0; have europe-west4 as fallback |
| 8 | **Preemption during training** — preemptible VMs can be reclaimed mid-run | Medium | Medium | Checkpoint every 100 steps to GCS; implement a recovery script; test this before the first real training run |
| 9 | **Schema drift between training and inference** — the JSON schema evolves during the spike and the fine-tuned model doesn't know about it | Low | High | Freeze the extraction schema on Day 1 of Phase 2 |
| 10 | **Cold start eats latency gains in A/B eval** — if the inference VM is stopped between eval runs to save credit, cold starts inflate latency measurements | High (if cost-cutting) | Medium | Keep the inference VM running continuously during the A/B eval window; budget ~£10/day explicitly |

### G.1) Empirical extraction model audit (Neon + logs)

**Purpose:** satisfy Day 1 of Risk 1 — know which vendor actually produced extraction JSON before treating production outputs as training labels.

**Sources checked:**

1. **`ingest_runs.report_envelope` → `timingTelemetry.stage_models.extraction`** — last successful extraction route string (`provider/model`), same field written by `scripts/ingest.ts` when timing is persisted.
2. **Last parseable `[INGEST_TIMING]` line per run in `ingest_run_logs`** — same payload shape; used when the envelope omits `stage_models.extraction`.
3. **Code defaults (new ingest):** `CANONICAL_INGESTION_PRIMARY_MODELS.extraction` is **`mistral` / `mistral-large-latest`** with **Mistral-only** fallbacks; `scripts/ingest.ts` also enforces **`INGEST_FINETUNE_LABELER_*`** so OpenAI/Anthropic/Vertex cannot appear in the effective chain for extraction/relations/grouping/remediation/json_repair unless you widen the allowlist. **Validation** remains on **Vertex** by default (cross-vendor check).

**Re-run locally (requires `DATABASE_URL`):**

```bash
pnpm ops:audit-ingest-extraction-models-neon
pnpm exec tsx scripts/audit-ingest-extraction-models-neon.ts -- --days=365
```

**Snapshot (Sophia production Neon, 2026-04-11):** among completed ingest runs in the measured window, **merged per-run** extraction routes were **`openai/gpt-4o-mini` on ~98%** of runs and **`anthropic/claude-opus-4-20250514` on ~2%** (single run in the sample). **90d and 365d windows matched** in that snapshot — effectively all instrumented history in range.

**Implication for Risk 1:** labels produced in those runs are **overwhelmingly OpenAI-generated**, with a **non-zero Anthropic** tail. Treat **mining raw production JSON as fine-tuning targets** as **likely ToS-blocked** unless you obtain explicit permission or **regenerate labels** with a generator whose terms explicitly allow downstream training (see mitigation options in your Risk 1 note: Mistral, DeepSeek, self-hosted open weights, Gemini/Vertex with legal sign-off). This is an **operational gate**, not a substitute for counsel reading current provider terms.

**Operational follow-up:** ordered gates (volume **before** ToS work), Neon vs Surreal scope, and minimal mitigation paths — [`ingestion-fine-tune-data-mitigation-plan.md`](./ingestion-fine-tune-data-mitigation-plan.md). **Surreal Cloud env + CLI:** [`surrealdb-cloud-access.md`](./surrealdb-cloud-access.md).

---

## H) Revised Phase 2 Plan — Day-by-Day

**Budget checkpoint targets:** Training runs: ~£15–30 each; inference VM uptime during A/B: ~£10/day; total Phase 2 target: <£200, leaving £300 for Phase 0/1/3/4 and overruns.

---

### Day 1 — Data Audit and Infrastructure Bootstrap
- **G0 volume:** run **`pnpm ops:audit-ingest-training-volume`** (and optional Surreal counts). If distinct sources after dedupe/quality filters are in the **red** zone of [`ingestion-fine-tune-data-mitigation-plan.md`](./ingestion-fine-tune-data-mitigation-plan.md) §1, **stop** the spike until the corpus grows.
- **G1 extraction model:** run **`pnpm ops:audit-ingest-extraction-models-neon`** (see **§G.1**). If production labels are dominated by OpenAI/Anthropic (empirically: yes in the 2026-04-11 Neon snapshot), flag the legal blocker and plan label regeneration with a policy-clear model before any training-data export.
- Request GPU quota in `europe-west2` and `europe-west4`.
- Create GCS bucket, Artifact Registry repo, and VPC firewall rules (allow port 8000 from worker subnet only).
- Export candidate training examples from production DB: all (URL, input span, extracted JSON) tuples from successful runs.
- Run schema validator over all candidates; discard failures; log pass rate (if <80%, production extraction quality is worse than assumed).

### Day 2 — Data Cleaning and Tokenization Analysis
- De-duplicate by input hash; de-duplicate against golden URL set.
- Measure input token length distribution. If p90 > 3000 tokens, plan for `max_seq_len=4096`.
- Stratify by source type; flag minority classes.
- Produce train/val/test split: 80/10/10, stratified, no URL overlap between splits.
- **Credit checkpoint:** If clean dataset size < 300 examples, the data pipeline is broken—do not proceed to training.

### Day 3 — Environment Setup and Smoke Test
- Provision preemptible L4 VM in `europe-west4`.
- Build training Docker image (nvidia/cuda base, Unsloth, TRL, PEFT). Push to Artifact Registry.
- Run a 50-step smoke-test training run on 20 examples. Verify: no OOM, checkpoints write to GCS, loss decreases, schema pass rate is computable as a callback.
- Pull vLLM official image; run inference smoke test with the base model to confirm OpenAI-compatible endpoint works end-to-end.

### Day 4 — Baseline Eval
- Run the base model (no fine-tuning) on the full golden URL eval set via the vLLM endpoint.
- Record: schema pass rate, faithfulness score (LLM-as-judge), extraction latency p50/p90.
- This is your control group. If the base model already matches production quality, fine-tuning may not be needed—evaluate latency gain from model size reduction alone.

### Day 5 — First Training Run
- Train QLoRA on full training set, 2 epochs, with val schema pass rate callback.
- Log to W&B. Monitor GPU utilisation, loss curves, VRAM.
- **Credit checkpoint:** If training cost > £25 for this run, something is misconfigured. Stop and diagnose.

### Day 6 — Eval of First Checkpoint + Iteration Decision
- Run fine-tuned adapter on golden eval set via vLLM.
- Compare schema pass rate, faithfulness, and latency to Day 4 baseline.
- **Decision gate:** If schema pass rate ≥ baseline and faithfulness within 5%: proceed to integration. If worse: diagnose and plan second training run.

### Day 7 — Second Training Run (if needed) or Integration
- If training metrics are good: begin integration into `ingest.ts` (set `EXTRACTION_BASE_URL`, keep existing path as shadow/fallback).
- If second training run needed: adjust hyperparams or clean data further; re-run. This is the last training iteration that fits in the budget.

### Day 8 — Shadow Mode Validation
- Run shadow extraction on 20–50 real URLs (not golden set): both the existing LLM path and the fine-tuned model path, compare outputs structurally.
- Flag any systematic differences (e.g., truncating claim lists, different relation types).
- Do not proceed to A/B if systematic regressions are found.

### Day 9 — A/B / Paired Eval
- Run paired ingestion on golden URL set: one worker using existing model, one using fine-tuned endpoint (min-replicas=1, VM running).
- Collect `[INGEST_TIMING]` JSON for both; compare E2E wall time and per-stage breakdown.
- Collect quality metrics: schema pass rate, downstream graph integrity checks.
- **Credit checkpoint:** Ensure cumulative spend is <£350 at this point, leaving £150 for buffer.

### Day 10 — Go/No-Go and Documentation
- Tabulate results against the 50% E2E / no-quality-loss targets.
- Write concise Phase 2 findings: what worked, what didn't, recommended Phase 3 path (or abort recommendation if quality gates failed).
- If go: document the exact model version, training config, inference container tag, and integration config for handoff to Phase 3.
- If no-go: document the nearest-miss scenario and what additional data/time would be required.

---

> **Final note on the plan's biggest unrealistic assumption:** The plan implicitly assumes that fine-tuning will improve quality or maintain it. There is a real scenario where a 7–8B fine-tuned model is strictly worse than the current GPT-4/Claude extraction path on tail cases, even if it's faster. The quality gates must be designed to catch this, and the go/no-go on Day 10 must be willing to say "faster but not good enough" and halt. Do not let timeline pressure override the quality gate decision.
