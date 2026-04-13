output "data_bucket_name" {
  description = "GCS bucket for JSONL, checkpoints, eval artifacts."
  value       = google_storage_bucket.phase2_data.name
}

output "artifact_registry_url" {
  description = "Docker push URL (repository root)."
  value       = "${var.region_artifacts}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.phase2.repository_id}"
}

output "training_region" {
  value = var.region_training
}

output "serving_zone" {
  value = var.zone_serving
}

output "enable_gpu_compute" {
  description = "When false, no GPU VMs are managed by this stack."
  value       = var.enable_gpu_compute
}

output "terraform_state_bucket_name" {
  description = "GCS bucket for Terraform state; use as backend \"gcs\" bucket after migrate."
  value       = google_storage_bucket.terraform_state.name
}
