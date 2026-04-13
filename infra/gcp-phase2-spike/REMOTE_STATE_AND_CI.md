# GCS remote state, dedicated Terraform SA, and CI `terraform plan`

Use project **`sophia-ai-spike`** (or your spike project ID) everywhere below. Run `gcloud config set project YOUR_PROJECT_ID` first.

---

## Part 1 — Ensure the state bucket exists

This repo’s Terraform creates **`${project_id}-tf-state`** ([`terraform_state_bucket.tf`](terraform_state_bucket.tf)).

```bash
cd infra/gcp-phase2-spike
# Creates sophia-ai-spike-tf-state (and other resources) if not already applied.
terraform apply
terraform output -raw terraform_state_bucket_name
```

If the bucket name differs, use the **output value** as `bucket` in Part 2.

---

## Part 2 — Migrate local state to GCS

1. **Create `backend.tf`** next to the other `.tf` files (file is **gitignored**). Do **not** paste the HCL block at the `zsh` prompt — the shell will try to parse `{` / `}` and error. Use an editor, or:

   ```bash
   cp backend.tf.example backend.tf
   ```

   Then edit `backend.tf`: remove the `#` comments and set `bucket` to `terraform output -raw terraform_state_bucket_name` (e.g. `sophia-ai-spike-tf-state`).

2. **Re-init and migrate** (from `infra/gcp-phase2-spike/`):

   ```bash
   terraform init -migrate-state
   ```

   When prompted, confirm **copy** of existing state to the remote backend.

3. **Verify**

   ```bash
   terraform state list | head
   gsutil ls gs://sophia-ai-spike-tf-state/phase2-spike/terraform/
   ```

4. **Back up / remove local state** only after you are confident remote state is correct:

   - After migrate, Terraform uses GCS; local `terraform.tfstate` may be empty or superseded. Do **not** commit `terraform.tfstate`.

### Who can read/write state?

Principals that run `terraform plan` / `apply` need **`storage.objects.get` / `create` / `update` / `delete`** on prefix `phase2-spike/terraform/**` in that bucket.

- **Your user:** usually **Owner** on the project — already OK if the bucket is in the same project.
- **Dedicated Terraform SA (below):** grant **`roles/storage.objectAdmin`** on bucket **`sophia-ai-spike-tf-state`** (or **`Storage Admin`** on the project if you accept broader scope for a spike-only project).

Grant SA on bucket (replace SA email):

```bash
gsutil iam ch serviceAccount:tf-runner-sophia-spike@sophia-ai-spike.iam.gserviceaccount.com:objectAdmin \
  gs://sophia-ai-spike-tf-state
```

---

## Part 3 — Dedicated Terraform service account

Create one SA used by **CI** (and optionally by humans via impersonation instead of personal Owner).

### 3a. Create the SA

```bash
export PROJECT_ID="sophia-ai-spike"
export TF_SA="tf-runner-sophia-spike"

gcloud iam service-accounts create "$TF_SA" \
  --project="$PROJECT_ID" \
  --display-name="Terraform Phase2 spike (CI + automation)"
```

Full email: **`tf-runner-sophia-spike@sophia-ai-spike.iam.gserviceaccount.com`**

### 3b. Grant project roles (spike-only project)

For an **isolated spike project**, the common pattern is **Editor** on that project only (simple; acceptable blast radius). Tighter custom roles are possible but high maintenance.

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${TF_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/editor"
```

**Also** grant state bucket access if the bucket is in the **same** project: `roles/editor` already includes GCS in-project. If state bucket were **external**, add explicit `objectAdmin` on that bucket only.

### 3c. Local use via impersonation (no JSON key)

```bash
# Your user (ADC); not the Terraform SA.
gcloud auth application-default login
export GOOGLE_IMPERSONATE_SERVICE_ACCOUNT="${TF_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
cd infra/gcp-phase2-spike
terraform plan
```

Unset when done:

```bash
unset GOOGLE_IMPERSONATE_SERVICE_ACCOUNT
```

Your user needs **`roles/iam.serviceAccountTokenCreator`** on the Terraform SA **or** `roles/iam.serviceAccountUser` + org policy allowing impersonation — **Owner** on the project can grant:

```bash
gcloud iam service-accounts add-iam-policy-binding "${TF_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --member="user:YOUR_EMAIL@gmail.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

(Use `group:` or `principalSet:` for a Google Group if preferred.)

---

## Part 4 — GitHub Actions: OIDC → GCP (no long-lived keys)

Uses **Workload Identity Federation** so GitHub receives short-lived tokens and **impersonates** the Terraform SA.

### 4a. Enable APIs (once per project)

```bash
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com --project="$PROJECT_ID"
```

### 4b. Create Workload Identity Pool + GitHub OIDC provider

Replace **`Allotment-Technology-Ltd`** and **`sophia`** with your GitHub org and repo name.

```bash
# Or your spike project id; must be non-empty.
export PROJECT_ID="sophia-ai-spike"
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export POOL_ID="github-actions"
export PROVIDER_ID="github-provider"
export GITHUB_ORG="Allotment-Technology-Ltd"
export GITHUB_REPO="sophia"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions"
```

If pool create **already succeeded** on a retry, skip pool create or delete the pool in Console and recreate — do **not** duplicate pools with the same id.

**OIDC provider:** many orgs now require an **`--attribute-condition`** that only references GitHub **`assertion.*`** claims. Without it, `create-oidc` can fail with: *attribute condition must reference one of the provider's claims*.

If a **failed** provider id exists, delete it first:

```bash
gcloud iam workload-identity-pools providers delete "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --quiet 2>/dev/null || true
```

Then create the provider (note **`attribute.repository`** uses `ORG/REPO` as GitHub sends it):

```bash
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition='assertion.repository=="Allotment-Technology-Ltd/sophia"'
```

Change the string **`Allotment-Technology-Ltd/sophia`** if your GitHub org/repo differ. You can widen later (e.g. multiple repos) with `assertion.repository in [...]` style only if supported; start with one repo.

### 4c. Allow GitHub repo to impersonate the Terraform SA

Set **`GITHUB_ORG`** and **`GITHUB_REPO`** if you have not since §4b (they are used in **`WIF_MEMBER`**). **`PROJECT_NUMBER`** must be set (from §4b: `gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'`).

```bash
# Same service account id as Part 3.
export TF_SA="tf-runner-sophia-spike"
export TF_SA_EMAIL="${TF_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export WIF_MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"

gcloud iam service-accounts add-iam-policy-binding "$TF_SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$WIF_MEMBER"
```

### 4d. Values for GitHub Actions

Set these **GitHub repository variables** (or organization secrets — not the JSON key):

| Name | Example value |
|------|----------------|
| `GCP_PROJECT_ID` | `sophia-ai-spike` |
| `GCP_STATE_BUCKET` | `sophia-ai-spike-tf-state` (must match `terraform output -raw terraform_state_bucket_name`) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github-provider` |
| `GCP_TERRAFORM_SA_EMAIL` | `tf-runner-sophia-spike@sophia-ai-spike.iam.gserviceaccount.com` |

`PROJECT_NUMBER` is numeric (from `gcloud projects describe`).

---

## Part 5 — GitHub Actions workflow (in repo)

The workflow **`.github/workflows/terraform-phase2-spike.yml`** runs **`fmt -check`**, **`init`**, **`validate`**, **`plan`** when **`infra/gcp-phase2-spike/**`** changes.

- The job is **skipped** until all four repository **Variables** are set (`GCP_PROJECT_ID`, `GCP_STATE_BUCKET`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_TERRAFORM_SA_EMAIL`).
- It **writes `backend.tf`** at job start (same GCS backend as local migrate), so CI does not commit `backend.tf`.

### CI and `terraform.tfvars`

- **`project_id`** is passed as **`TF_VAR_project_id`** from `GCP_PROJECT_ID`.
- Add more **`TF_VAR_*`** env vars on plan/validate steps if you introduce required variables without defaults.
- Do **not** commit `terraform.tfvars` or SA JSON keys.

---

## Checklist

| Step | Done |
|------|------|
| State bucket exists (`terraform apply`) | |
| `backend.tf` + `terraform init -migrate-state` | |
| SA `tf-runner-sophia-spike` created | |
| SA binding `roles/editor` on spike project | |
| WIF pool + GitHub provider | |
| SA `roles/iam.workloadIdentityUser` for `principalSet:...repository/ORG/REPO` | |
| GitHub vars: `GCP_PROJECT_ID`, `GCP_STATE_BUCKET`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_TERRAFORM_SA_EMAIL` | |
| Workflow runs on PR touching `infra/gcp-phase2-spike/**` | |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Error 403: Request had insufficient authentication scopes` | Regenerate WIF provider mapping; confirm `id-token: write` in workflow. |
| `storage.objects.get` denied on state bucket | Grant Terraform SA **objectAdmin** on `gs://…-tf-state` (or Editor on project). |
| `terraform init` wants reconfigure | Same `backend.tf` in CI as locally; same bucket/prefix. |
| Impersonation denied locally | Grant your user **Token Creator** on the Terraform SA. |

Official references: [WIF with GitHub](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [GCS backend](https://developer.hashicorp.com/terraform/language/settings/backends/gcs).
