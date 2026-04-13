# GPU GCE is intentionally omitted until enable_gpu_compute = true (after G1 pause).
# When you enable it, extend this file with:
# - google_compute_instance training (preemptible L4, europe-west4)
# - google_compute_instance vllm (non-preemptible L4, europe-west2)
# and wire google_compute_firewall below to var.admin_cidr_blocks.

resource "google_compute_firewall" "vllm_ingress" {
  count   = var.enable_gpu_compute && length(var.admin_cidr_blocks) > 0 ? 1 : 0
  name    = "sophia-phase2-vllm-8000"
  network = "default"
  project = var.project_id

  source_ranges = var.admin_cidr_blocks

  allow {
    protocol = "tcp"
    ports    = ["8000"]
  }

  target_tags = ["sophia-phase2-vllm"]

  description = "vLLM OpenAI-compatible port; restrict source_ranges to known worker/office IPs."

  depends_on = [google_project_service.required]
}
