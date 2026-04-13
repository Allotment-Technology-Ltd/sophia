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

Complete after first successful apply (operator sign-off):

- [x] Core APIs + data bucket + Artifact Registry applied (`terraform apply`).
- [x] Provider lockfile **`.terraform.lock.hcl`** committed with this stack.
- [ ] **Terraform state bucket** applied (run `terraform apply` again after pulling this branch if `terraform_state_bucket.tf` is new).
- [ ] **Remote state migrated** to GCS (`init -migrate-state`) when more than one person will run Terraform.
- [ ] **L4 quota** requests filed (see below).

## Requesting NVIDIA L4 GPU quota (Console)

Do this in your spike **project** (e.g. `sophia-ai-spike`) **before** turning on `enable_gpu_compute`.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select the spike **project**.
2. Go **IAM & Admin** → **Quotas** (or search “Quotas”).
3. In the filter bar, choose **Service** = **Compute Engine API**.
4. Filter **Name** or **Metric** for **L4** (labels vary; try `NVIDIA L4` / `GPUs (preemptible)` / `Committed NVIDIA L4` — pick the row that matches **per-region** GPU for **Compute**).
5. Check rows for **Location** = **`europe-west2`** and **`europe-west4`** (request both; training defaults to **west4**, vLLM to **west2** per spike plan).
6. Select the quota line(s) → **Edit quota** (or **Request increase**).
7. Request enough for **one** training VM + **one** serving VM (e.g. **2** GPUs per region as a starting ask, or **1** if the form requires minimal increase). Add a note: *Sophia Phase 2 spike — single L4 for QLoRA training / vLLM*.
8. Submit; approval can take **hours to days**. Track in **Quota** history.

If the metric is only **global**, request the increase and note preferred regions in the justification.

`gcloud` alternative (after [installing SDK](https://cloud.google.com/sdk/docs/install)):

```bash
gcloud config set project YOUR_PROJECT_ID
# List L4-related quotas (IDs differ by account):
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
