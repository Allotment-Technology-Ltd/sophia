# GCP Phase 2 spike — Terraform (Sophia / plotbudget.com org)

Spike scope: **APIs**, **GCS** (datasets / checkpoints / evals), **Artifact Registry** (Docker). **No GPU VMs** until `enable_gpu_compute = true` (after G1 pause in the Phase 2 plan).

## Prerequisites

- GCP project created under **plotbudget.com** org, billing linked.
- Your user has **Owner** / **Editor** (you already confirmed IAM).
- [Google Cloud SDK](https://cloud.google.com/sdk) optional but useful for one-off commands.
- [Terraform](https://developer.hashicorp.com/terraform/install) `>= 1.6`.

## Quick start

`terraform.tfvars` is **HCL**: only `name = value` assignments and **`#` line comments**. Do not paste prose headings without `#` (Terraform will error with “Invalid block definition”).

```bash
cd infra/gcp-phase2-spike
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set project_id (required).

terraform init
terraform fmt -recursive
terraform validate
terraform plan
```

Apply when ready:

```bash
terraform apply
```

## Remote state, Terraform SA, and CI

Step-by-step (migrate state, create **`tf-runner-…`** SA, GitHub OIDC, sample workflow): **[`REMOTE_STATE_AND_CI.md`](REMOTE_STATE_AND_CI.md)**.

## Remote state (GCS backend, recommended)

This stack defines **`${project_id}-tf-state`** in [`terraform_state_bucket.tf`](terraform_state_bucket.tf) (versioning on, `europe-west2`). **Apply once** so the bucket exists, then migrate local state:

```bash
terraform apply   # creates ${project_id}-tf-state (see terraform_state_bucket.tf)

# Create backend.tf (gitignored) — bucket must match output:
terraform output -raw terraform_state_bucket_name

# Copy backend.tf.example → backend.tf, uncomment the terraform { } block,
# set bucket to the value above, prefix = "phase2-spike/terraform".

terraform init -migrate-state
# Answer yes to copy state to GCS.
```

`backend.tf` and `terraform.tfvars` stay **local / gitignored**; only `backend.tf.example` is in git.

## Pause checklist — `parallel-iac-prereqs` / `pause-after-iac-prereqs`

Complete after first successful apply (operator sign-off). **Status (2026-04-13):**

- [x] Core APIs + data bucket + Artifact Registry applied (`terraform apply`).
- [x] Provider lockfile **`.terraform.lock.hcl`** committed with this stack.
- [x] **Terraform state bucket** applied (`…-tf-state` exists).
- [x] **Remote state migrated** to GCS (`terraform init -migrate-state` → `default.tfstate` under `phase2-spike/terraform/`).
- [x] **L4 quota** — **default limit 1× NVIDIA L4** in **`europe-west2`** and **`europe-west4`** is enough for **one training VM (west4) + one vLLM VM (west2)** without an increase. Only file a **quota increase** if you need **more than one L4 in the same region** or a denial blocks create.

## NVIDIA L4 GPU quota (Console)

**If defaults are 1 per region (typical new project):** skip increase; proceed to GPU Terraform only after plan **`pause-after-g1`**.

**If you need an increase** (e.g. 2+ L4 in one region):

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select the spike **project**.
2. Go **IAM & Admin** → **Quotas** (or search “Quotas”).
3. **Service** = **Compute Engine API**; filter metric name for **NVIDIA L4** / **L4**.
4. Select **Location** = **`europe-west2`** or **`europe-west4`** as needed.
5. **Edit quota** → enter new limit → justify (*Sophia Phase 2 spike — QLoRA + vLLM*). New projects may be asked to wait **48h** billing history before approval.

`gcloud` alternative (after [installing SDK](https://cloud.google.com/sdk/docs/install)):

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud alpha services quota list --consumer=projects/YOUR_PROJECT_ID --filter="metric.type:compute.googleapis.com" --format="table(name,metric,limit)" 2>/dev/null | head -50
```

Use Console if CLI filtering is unclear.

## GPU / vLLM (later)

- Set `enable_gpu_compute = true` only after the plan’s **`pause-after-g1`**.
- Set `admin_cidr_blocks` to **known** IPs (office / VPN / static worker egress) before opening port **8000**; do not use `0.0.0.0/0` for vLLM.
- Extend `compute.tf` with the actual `google_compute_instance` resources (L4 training in `region_training`, vLLM in `region_artifacts` zone) — this skeleton only adds the firewall when both flags are satisfied.

## Regions (defaults)

| Use              | Default region | Notes                                      |
|------------------|----------------|--------------------------------------------|
| GCS, AR, state   | `europe-west2` | Aligns with spike plan / Neon egress story |
| Training GPU     | `europe-west4` | Better L4 quota / stock                    |

## Quota

Request **L4** GPU quota in **europe-west2** and **europe-west4** in Console before first GPU apply.
