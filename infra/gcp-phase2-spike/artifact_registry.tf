resource "google_artifact_registry_repository" "phase2" {
  location      = var.region_artifacts
  repository_id = "sophia-phase2"
  description   = "Training and vLLM images for Sophia ingestion Phase 2 spike"
  format        = "DOCKER"
  project       = var.project_id

  labels = var.labels

  depends_on = [google_project_service.required]
}
