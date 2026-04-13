# Dedicated bucket for Terraform remote state (GCS backend).
# After this exists, copy backend.tf.example → backend.tf and run
# `terraform init -migrate-state` (see README).

resource "google_storage_bucket" "terraform_state" {
  name                        = "${var.project_id}-tf-state"
  location                    = var.region_artifacts
  project                     = var.project_id
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  labels = merge(var.labels, { purpose = "terraform-state" })

  depends_on = [google_project_service.required]
}
