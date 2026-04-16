# Fireworks: deploy Phase 2 extraction model (low-infra path)

Use this after you have a **Fireworks account** and an **API key** ([dashboard → API keys](https://app.fireworks.ai/settings/users/api-keys)). Sophia only needs an **OpenAI-compatible** base URL + model id + key (`EXTRACTION_*`); see [`.env.example`](../../.env.example). **Step D** (merge / lineage / publish / teardown checklist): [`../local/operations/phase2-step-d-artifacts-runbook.md`](../local/operations/phase2-step-d-artifacts-runbook.md).

Official references:

- [Install `firectl`](https://docs.fireworks.ai/getting-started/ondemand-quickstart) and `firectl signin`
- [Upload custom models](https://docs.fireworks.ai/models/uploading-custom-models) (merged HF dirs **or** LoRA addon)
- [On-demand deployments](https://docs.fireworks.ai/guides/ondemand-deployments) (GPU billing, scale-to-zero)

---

## Addendum (2026-04) — **Fine-tune on Fireworks (SFT)** as the primary lean loop

**Goal:** Train extraction LoRA **on Fireworks** using the **same** chat JSONL produced by `pnpm ops:phase2-step-a-together-packaging` (`train.together.jsonl`, `validation.together.jsonl`). Then **`firectl deployment create`** on the **output model id** from the completed job. This avoids **Together** fine-tune → download merged/LoRA tarball → `firectl model create` for routine iterations.

**Official workflow:** [Supervised Fine Tuning — Text](https://docs.fireworks.ai/fine-tuning/fine-tuning-models) (dataset JSONL `messages`, `firectl dataset create`, `firectl sftj create`, deploy).

### Operator checklist

1. **Starting model (Sophia default)** — Merged upload **`sophia-extract-m7b-ft`** was **verified** with **`firectl model get sophia-extract-m7b-ft`** (2026-04-16): **`Tunable: true`**, **`State: READY`**, **`Kind: HF_BASE_MODEL`**. Use **`--base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft`** for SFT from **your** weights. Re-run `firectl model get` after any model recreate or vendor change; if **Tunable** flips false, fall back to a **catalog** Tunable base or off-platform training (earlier sections of this doc). For **iteration 2+** after a Fireworks SFT job, use **`--warm-start-from accounts/<account>/models/<prior_sft_output>`** (see [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md)).
2. **Package data** — `pnpm ops:phase2-step-a-together-packaging -- --export-dir data/phase1-training-export` (G1-cleared export only).
3. **Submit SFT** — either:
   - **Script (repo):** `pnpm ops:fireworks-submit-sft -- --dry-run …` then live run with `--training-file …/train.together.jsonl` [`--validation-file …/validation.together.jsonl`] and **either** `--base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft` **or** `--warm-start-from accounts/.../models/your-prior-sft-output` — plus **`--output-model sophia-extract-sft-iter1`** (a real lowercase slug; **do not** wrap placeholders in angle brackets in the shell — zsh treats `<` as input redirection) and optional `--write-report …/fireworks-sft-job-submitted.json`. Requires **`FIREWORKS_API_KEY`** and **`FIREWORKS_ACCOUNT_ID`** (or infer from `EXTRACTION_MODEL=accounts/<id>/deployments/...`).
   - **CLI:** `firectl dataset create <DATASET_ID> /path/to/train.jsonl` and `firectl sftj create --base-model … --dataset … --output-model …` (or `--warm-start-from …`) per Fireworks docs.
4. **Wait for job** — UI or `firectl sftj get <job-or-id per vendor>`.
5. **Deploy** — `firectl deployment create <FINE_TUNED_MODEL_ID>` (see [Deploying fine-tuned models](https://docs.fireworks.ai/fine-tuning/deploying-loras)); set `EXTRACTION_MODEL` to the deployment **Name**.
6. **Eval** — `pnpm ops:eval-extraction-compare` (see [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md)).

**Lean plan + todos:** [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md). **Legacy Together path:** [`docs/local/operations/together-lora-phase2-runbook.md`](../local/operations/together-lora-phase2-runbook.md) (clone locally if missing).

---

## 1. Choose an artifact shape

| Path | When to use |
|------|-------------|
| **Merged weights** (HF folder: `config.json`, `*.safetensors`, tokenizer) | Fewest vendor constraints; matches `scripts/ml/merge_peft_lora.py` output. |
| **LoRA-only upload** (`adapter_config.json` + `adapter_model.safetensors`) | Smaller upload; Fireworks must support the **base** model id you pass. On-demand only. |

### Artifacts in this repo (`data/phase1-training-export/`)

Together downloads for job **`ft-d95bacfb-6f78`**:

| Location | Contents |
|----------|----------|
| `merged-bfl6-adapter/ft-d95bacfb-6f78-2026-04-15-21-03-23.tar.zst` (~11 GB) | **Merged** full model (`config.json`, `model-*-of-*.safetensors`, tokenizers). Extract to a directory and pass **that directory** to `firectl model create` — **no** `merge_peft_lora.py` step. |
| `ft-d95bacfb-6f78-adapter/ft-d95bacfb-6f78_adapter-2026-04-15-21-03-23.tar.zst` (~620 MB) | **LoRA** adapter (`adapter_config.json`, `adapter_model.safetensors`, …). Extract, then use Fireworks [LoRA upload](https://docs.fireworks.ai/models/uploading-custom-models#importing-fine-tuned-models) with `--base-model …`. |

Extract example for the **merged** archive (from repo root):

```bash
mkdir -p data/phase1-training-export/merged-bfl6-hf
tar -xf data/phase1-training-export/merged-bfl6-adapter/ft-d95bacfb-6f78-2026-04-15-21-03-23.tar.zst \
  -C data/phase1-training-export/merged-bfl6-hf --strip-components=1
```

Then pick a **short model slug** (lowercase letters, digits, hyphens only — **no** `accounts/` or `/` in this argument). `firectl` attaches your account from `firectl signin` / `~/.fireworks/auth.ini`. Example: `sophia-extract-m7b-ft`.

```text
firectl model create sophia-extract-m7b-ft \
  "$(pwd)/data/phase1-training-export/merged-bfl6-hf"
```

See [firectl model create](https://docs.fireworks.ai/tools-sdks/firectl/commands/model-create) (`my-model` style ids).

Together’s smaller adapter tarball is only for **LoRA** flows; it is **not** a full HF weight tree by itself.

**Base model for merge** (only if you are merging locally instead of using the merged tarball above; Together job used v0.2):

```bash
python scripts/ml/merge_peft_lora.py \
  --base mistralai/Mistral-7B-Instruct-v0.2 \
  --adapter /path/to/peft-adapter-dir \
  --out ./merged-mistral7b-extraction-bf16
```

Clear **`pause-after-vendor-ft`** (and counsel gates) before uploading weights you are not allowed to share.

## 2. Upload the model (`firectl`)

**First argument = short model id** (e.g. `sophia-extract-m7b-ft`), not `accounts/.../models/...`.

**Merged directory:**

```bash
export FIREWORKS_API_KEY="…"
firectl signin   # if needed

firectl model create sophia-extract-m7b-ft \
  ./merged-mistral7b-extraction-bf16/

firectl model get sophia-extract-m7b-ft
# wait until State: READY
```

**LoRA directory** (requires a Fireworks **base** model that supports LoRA; confirm in Fireworks docs / UI):

```bash
# Optional: add fireworks.json in the adapter dir (defaults, has_lora, etc.) — see Fireworks “Importing fine-tuned models”.
firectl model create sophia-extract-lora \
  /path/to/adapter-files/ \
  --base-model "accounts/fireworks/models/<SUPPORTED_BASE_MISTRAL_ID>"
```

## 3. Create an on-demand deployment

**Custom uploaded models:** do **not** use `--deployment-shape cost` (or `fast` / `throughput`) unless that shape exists for *your* model — Fireworks often returns *“deployment shape version does not exist or you do not have access”* because those names are tied to **catalog** base models. Omit `--deployment-shape` and let Fireworks pick defaults for your weights.

**Min replicas 0** and a **short scale-to-zero** window keep eval bursts cheaper (cold-start 503s possible; the eval script retries).

You can pass the **same short id** or the full `accounts/<ACCOUNT_ID>/models/<slug>` form — see [firectl deployment create](https://docs.fireworks.ai/tools-sdks/firectl/commands/deployment-create).

If you need an explicit shape later, list validated versions for your model. **Custom models:** try the **full** model id if the short slug returns an **empty** table (headers only):

```bash
firectl deployment-shape-version list --base-model sophia-extract-m7b-ft
firectl deployment-shape-version list --base-model accounts/<ACCOUNT_ID>/models/sophia-extract-m7b-ft
```

If the list is **still empty**, skip `--deployment-shape`. For **custom chat models** Fireworks still requires an **accelerator** when no shape supplies one: use `--accelerator-type` (and usually `--accelerator-count 1`). Allowed types are vendor-defined (often `NVIDIA_A100_80GB`, `NVIDIA_H100_80GB`, … — see `firectl deployment create --help`).

```bash
firectl deployment create sophia-extract-m7b-ft \
  --accelerator-type NVIDIA_A100_80GB \
  --accelerator-count 1 \
  --min-replica-count 0 \
  --max-replica-count 1 \
  --scale-to-zero-window 5m \
  --scale-down-window 5m \
  --scale-up-window 30s \
  --wait
```

If provisioning fails in your region, try `NVIDIA_H100_80GB` instead of A100.

Copy the deployment **Name** from the output, e.g. `accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>`.

## 4. Wire Sophia (`EXTRACTION_*`)

```bash
export EXTRACTION_BASE_URL="https://api.fireworks.ai/inference/v1"
export EXTRACTION_MODEL="accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>"
export EXTRACTION_API_KEY="$FIREWORKS_API_KEY"
# Or set FIREWORKS_API_KEY only; Sophia falls back to it for this base URL (see src/lib/server/vertex.ts).
```

Print the same lines from a deployment name:

```bash
bash scripts/fireworks-extraction-eval-env.sh accounts/your-id/deployments/your-deployment-id
```

### GCP: Secret Manager → Cloud Run (ingest workers + main service)

Store **`EXTRACTION_BASE_URL`**, **`EXTRACTION_MODEL`**, and **`FIREWORKS_API_KEY`** (or **`EXTRACTION_API_KEY`** instead of `FIREWORKS_API_KEY`; see [`src/lib/server/vertex.ts`](../../src/lib/server/vertex.ts)) as Secret Manager secrets. Deploy bindings live in [`scripts/gcp/deploy-sophia-ingest-worker-service.sh`](../../scripts/gcp/deploy-sophia-ingest-worker-service.sh), [`scripts/gcp/deploy-sophia-ingestion-poller-job.sh`](../../scripts/gcp/deploy-sophia-ingestion-poller-job.sh), and the main **`sophia`** service `--set-secrets` line in [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). Secret **ids** in those files must match what you created (or edit the mapping). Grant the runtime service account **Secret Accessor** on each secret, then **redeploy** so new revisions mount the env vars (creating secrets in the console alone does not inject them).

**Local audit:** record eval/ingest smoke outcomes (including Fireworks **404** when a deployment is disabled) in [`../local/operations/phase2-step-f-local-verification-log.md`](../local/operations/phase2-step-f-local-verification-log.md).

## 4.5 While upload / deploy runs (save billed time later)

Do this **now** so you only paste the deployment id when `firectl deployment create` finishes:

1. In **`.env.local`**, set (or keep) **`FIREWORKS_API_KEY`** and **`EXTRACTION_BASE_URL=https://api.fireworks.ai/inference/v1`**. Leave **`EXTRACTION_MODEL`** empty until you have the deployment **`Name:`**; then set it to that full string in one edit.
2. From repo root, confirm the eval inputs exist: **`data/phase1-training-export/golden_holdout.jsonl`**.
3. Stay in repo root for **`pnpm`** so paths resolve.

`loadServerEnv()` in the eval script loads **`.env`** then **`.env.local`** (override), so you do **not** need to re-export vars in the shell if they are in `.env.local`.

## 5. Run Step C eval (golden holdout)

The eval script **warms up** Fireworks by default (one tiny completion), then **retries** on **503** / **429** / retryable SDK errors (see `EXTRACTION_EVAL_MAX_TRANSIENT_RETRIES`, default **8**). Skip warmup: `--no-warmup` or `EXTRACTION_EVAL_WARMUP=0`.

```bash
cd /Users/adamboon/projects/sophia
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --out data/phase1-training-export/eval-fireworks-extraction.json
```

Eval defaults to **folding the system prompt into the user message** (matches Together SFT `user-assistant-folded-system`). If your served tokenizer rejects that, set `EXTRACTION_EVAL_FOLD_SYSTEM=0` for the eval run only.

If many rows still fail after warm retries, temporarily raise **min replicas** on the deployment (higher cost) and re-run the same command.

### Interpreting the eval JSON (label alignment)

For **`golden_holdout.jsonl`**, each row’s **`input`** is a **single sentence** and matches **`label.text`**; gold **`position_in_source`** is **document-level** (ordering in the full SEP entry), not inferable from that one sentence alone. The model therefore often returns the **correct claim text** with a **different local** `position_in_source`.

- **`subsetTextMatchRate`** — fraction of gold-eligible rows where **some** returned claim has the same **`text`** as the gold label (trimmed). **Treat this as the primary alignment metric** for this holdout file.
- **`subsetMatchRate`** — strict: same **`text`** **and** **`position_in_source`** on one claim. Expect it to stay low on sentence-only rows; it is still useful when your JSONL supplies full multi-claim context where positions are meaningful.

The report also includes **`subsetEligibleRowsWhereInputEqualsGoldText`** and **`singleSentenceGoldEvalAllEligibleRows`** so you can confirm the file shape. For bucket-level debugging (paraphrase vs position vs split), add **`--mismatch-diagnostics`** to the same command (see script header in `scripts/eval-extraction-holdout-openai-compatible.ts`).

**Recorded runs (2026-04-16):** golden + multi-domain remit eval outputs, metric summaries, and copy-paste commands live in **[`docs/local/operations/extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md)**. Weight tarball / index **SHA-256** and historical deployment ids are summarized in **[`data/phase1-training-export/artifact-ft-d95bacfb-6f78.json`](../../data/phase1-training-export/artifact-ft-d95bacfb-6f78.json)** (refresh: `pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export`). Write **`--out …/eval-fireworks-*.json`** to archive new runs under [`data/phase1-training-export/`](../../data/phase1-training-export/) (re-run overwrites). Commit those JSON files if you want findings frozen in git. Session pointers: [`NEXT_SESSION_HANDOFF.md`](../local/operations/NEXT_SESSION_HANDOFF.md), [`phase1-to-phase2-handover.md`](../local/operations/phase1-to-phase2-handover.md).

### Multi-domain remit eval (go/no-go beyond golden holdout)

`golden_holdout.jsonl` is intentionally small and can skew toward a few golden URLs (e.g. Aquinas-heavy in some samples). For **breadth** before product go/no-go, build a stratified slice from **`validation.jsonl` + `test.jsonl` only** (default): those URLs are **stratified out of `train.jsonl`** in G0 export, so they are **not** the same lines as the Together SFT file built from **`train.together.jsonl`**. You still keep **`golden_holdout.jsonl`** as the **true golden-URL** holdout; the remit file is an additional **non-train** breadth check.

```bash
pnpm ops:sample-extraction-remit-eval-jsonl -- \
  --export-dir data/phase1-training-export \
  --out eval_remit_multidomain.jsonl \
  --total 200 \
  --seed 42
```

This writes **`eval_remit_multidomain.jsonl`** plus **`eval_remit_multidomain.manifest.json`** (domain + `source_url` counts). Tuning knobs:

| Flag | Default | Purpose |
|------|---------|---------|
| `--from` | `validation.jsonl,test.jsonl` | Comma-separated basenames under `--export-dir` (**omit `train.jsonl`** unless you want an in-distribution stress test) |
| `--total` | `200` | Row count |
| `--min-per-domain` | `5` | Floor per domain (auto-clamped vs `--total`) |
| `--max-per-source-url` | `25` | Cap rows per SEP URL |
| `--exclude-url-substrings` | *(empty)* | Comma list, case-insensitive substring match on `source_url` (e.g. `aquinas` to force non-Aquinas rows) |
| `--seed` | `42` | Reproducible shuffle |

Then run the **same** OpenAI-compatible eval (after deploy):

```bash
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/eval_remit_multidomain.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-fireworks-remit-multidomain.json
```

Compare **`subsetTextMatchRate`**, **`schemaPassRate`**, and latency to the golden-holdout report. Rows are still **sentence-level** (`input` matches claim text in export); **`subsetMatchRate`** (strict position) remains a weak signal for the same document-level-position reason as §5.

**Stricter than default `validation` + `test`:** Together also uploaded **`validation.together.jsonl`** as the job’s validation file, so those rows may have appeared in **training-time validation loss** (not the SFT gradient batches, but not “never seen”). For the cleanest post-hoc check within this export, use **`--from test.jsonl`** only (~646 lines; fewer domains/URLs but no val overlap).

## 6. Tear-down, retention, and API key hygiene

### Stop GPU billing (Fireworks)

Delete **deployments** before deleting **models** (Fireworks enforces ordering).

```bash
firectl deployment delete accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>
# Optionally remove the uploaded model when you no longer need it.
# firectl model delete <short-slug-used-at-model-create>
```

See **Step E** under **Exact commands (this repo + account `adam-boon1984-17nryg`)** later in this file for the full worked example.

### GCS mirror (optional)

For multi-gigabyte tarballs and extracted HF trees, prefer a **private** bucket with **IAM** (least privilege) and a **lifecycle rule** (e.g. delete objects after 30–90 days for pilots). The repo script [`scripts/ml/write_phase2_artifact_manifest.py`](../../scripts/ml/write_phase2_artifact_manifest.py) can upload **only the JSON lineage sidecar** when `PHASE2_ARTIFACT_GCS_URI` is set; large blobs are still copied with `gsutil cp` / object versioning under your own runbook. Align uploads with [`docs/sophia/ingestion-extraction-phase2-pause-after-vendor-ft.md`](./ingestion-extraction-phase2-pause-after-vendor-ft.md).

### API keys and local env

After a pilot, **rotate** the Fireworks API key if it was shared or pasted into chat logs. Remove **`EXTRACTION_*`** / **`FIREWORKS_API_KEY`** from **`.env.local`** when you are done so local scripts do not keep calling the vendor (see **Step F** in the exact-commands section below).

### Ingestion (`scripts/ingest.ts`) — Fireworks chat template

On-demand deployments may use a **Jinja** chat template that rejects a separate OpenAI **`system`** message (HTTP **400**: roles must alternate `user`/`assistant`). Sophia folds **`EXTRACTION_SYSTEM`** into the **`user`** message when **`EXTRACTION_BASE_URL`** points at **`api.fireworks.ai`** (same idea as Together SFT + **`together.xyz`**). If you add another OpenAI-compatible host with the same constraint, extend the fold rule in `scripts/ingest.ts` / `model-call.ts` or set a dedicated **`EXTRACTION_API_KEY`** and match the eval script’s folding behaviour.

### Lineage sidecar (weights ↔ manifest ↔ eval)

Machine-readable hashes and historical deployment ids for job **`ft-d95bacfb-6f78`** live in [`data/phase1-training-export/artifact-ft-d95bacfb-6f78.json`](../../data/phase1-training-export/artifact-ft-d95bacfb-6f78.json). Refresh after re-download or re-extract:

```bash
pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export
```

---

## Exact commands (this repo + account `adam-boon1984-17nryg`)

Run in order. Replace `YOUR_FW_API_KEY` with your key from the [Fireworks dashboard](https://app.fireworks.ai/settings/users/api-keys). After step 5, replace `PASTE_DEPLOYMENT_NAME` with the full **`Name:`** line from the output (looks like `accounts/adam-boon1984-17nryg/deployments/...`).

```bash
cd /Users/adamboon/projects/sophia

mkdir -p data/phase1-training-export/merged-bfl6-hf
tar -xf data/phase1-training-export/merged-bfl6-adapter/ft-d95bacfb-6f78-2026-04-15-21-03-23.tar.zst \
  -C data/phase1-training-export/merged-bfl6-hf --strip-components=1

export FIREWORKS_API_KEY="YOUR_FW_API_KEY"

firectl model create sophia-extract-m7b-ft \
  "/Users/adamboon/projects/sophia/data/phase1-training-export/merged-bfl6-hf"

firectl model get sophia-extract-m7b-ft
```

Repeat `firectl model get sophia-extract-m7b-ft` until the model is **READY**, then:

```bash
firectl deployment create sophia-extract-m7b-ft \
  --accelerator-type NVIDIA_A100_80GB \
  --accelerator-count 1 \
  --min-replica-count 0 \
  --max-replica-count 1 \
  --scale-to-zero-window 5m \
  --scale-down-window 5m \
  --scale-up-window 30s \
  --wait
```

Then set **`EXTRACTION_MODEL`** in **`.env.local`** to the deployment **`Name:`** value, save, and run eval (no need to `export` if vars are in `.env.local`):

```bash
cd /Users/adamboon/projects/sophia
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --out data/phase1-training-export/eval-fireworks-extraction.json
```

Shell alternative (same effect):

```bash
export EXTRACTION_BASE_URL="https://api.fireworks.ai/inference/v1"
export EXTRACTION_MODEL="PASTE_DEPLOYMENT_NAME"
export EXTRACTION_API_KEY="$FIREWORKS_API_KEY"
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --out data/phase1-training-export/eval-fireworks-extraction.json
```

---

## Playbook: upload finished → eval done → turn deployment off

Use when **`firectl model create …` has finished uploading** and the model appears in the Fireworks UI (e.g. `accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft`).

### Step A — Wait until the model is importable (`READY`)

```bash
firectl model get sophia-extract-m7b-ft
```

Use your slug if it differs. Repeat until output shows the model is **ready** to deploy (`READY` or equivalent).

**Do not** put the `…/models/…` id into `EXTRACTION_MODEL` for Sophia — that is the *weights* record. Chat eval needs a **deployment** `Name:` (Step B).

### Step B — Create deployment; capture `Name:`

(Omit `--deployment-shape` for custom uploads — see §3 above. **Do** pass `--accelerator-type` — required for non-embedding engines.)

```bash
firectl deployment create sophia-extract-m7b-ft \
  --accelerator-type NVIDIA_A100_80GB \
  --accelerator-count 1 \
  --min-replica-count 0 \
  --max-replica-count 1 \
  --scale-to-zero-window 5m \
  --scale-down-window 5m \
  --scale-up-window 30s \
  --wait
```

Copy the full line after **`Name:`** — e.g. `accounts/adam-boon1984-17nryg/deployments/xxxxxxxx`. That entire string is **`EXTRACTION_MODEL`**.

### Step C — Put variables in `.env.local`

Edit **`/Users/adamboon/projects/sophia/.env.local`** (gitignored). Eval loads `.env` then `.env.local` with override.

| Variable | When | Source |
|----------|------|--------|
| `FIREWORKS_API_KEY` | Before eval | [API keys](https://app.fireworks.ai/settings/users/api-keys); same as `firectl`. |
| `EXTRACTION_BASE_URL` | Before eval | Always `https://api.fireworks.ai/inference/v1` |
| `EXTRACTION_MODEL` | **After** Step B | Full **`Name:`** from deployment create (`accounts/.../deployments/...`). |
| `EXTRACTION_API_KEY` | Optional | Same value as `FIREWORKS_API_KEY` if you want it explicit; else omit (Sophia falls back to `FIREWORKS_API_KEY` for this host). |

Save the file.

### Step D — Run eval (repo root)

```bash
cd /Users/adamboon/projects/sophia
pnpm ops:eval-extraction-holdout-openai-compatible -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --out data/phase1-training-export/eval-fireworks-extraction.json
```

Stdout = JSON summary; **`--out`** = report file path. For **`golden_holdout.jsonl`**, use **`subsetTextMatchRate`** as the main label-alignment score (see §5 *Interpreting the eval JSON*). Optional: **`--mismatch-diagnostics`** for mismatch buckets and samples.

### Step E — Delete deployment (stop GPU billing)

```bash
firectl deployment delete accounts/adam-boon1984-17nryg/deployments/YOUR_DEPLOYMENT_ID
```

Use the **same** deployment id as in `EXTRACTION_MODEL` (pass the full `accounts/.../deployments/...` string if your CLI accepts it).

**Optional:** remove the uploaded model from your account — check `firectl model --help` for the delete subcommand, e.g. `firectl model delete sophia-extract-m7b-ft`. **`firectl model delete` does not support `--ignore-checks`** (that flag exists only on **`firectl deployment delete`**). Delete deployments using the model first, then delete the model.

### Step F — Optional local cleanup

Comment out or remove **`EXTRACTION_MODEL`**, **`EXTRACTION_BASE_URL`**, and extraction-only keys from **`.env.local`** when finished so local runs do not keep calling Fireworks.

### Lean iterative FT (hypothesis → build → measure → learn)

Full plan (Fireworks SFT primary, todos): [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md). Baseline eval commands: [extraction-ft-lean-baseline.md](./extraction-ft-lean-baseline.md). Append-only log: [extraction-ft-lean-iteration-log.md](./extraction-ft-lean-iteration-log.md). Combined eval: `pnpm ops:eval-extraction-compare`.
