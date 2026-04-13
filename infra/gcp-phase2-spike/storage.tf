resource "google_storage_bucket" "phase2_data" {
  name                        = "${var.project_id}-${var.data_bucket_suffix}"
  location                    = var.region_artifacts
  project                     = var.project_id
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  labels = var.labels

  depends_on = [google_project_service.required]
}
