variable "project_id" {
  description = "GCP project ID for the Phase 2 spike (dedicated project under plotbudget.com org)."
  type        = string
}

variable "region_artifacts" {
  description = "Region for GCS, Artifact Registry, and Terraform state bucket (if created here)."
  type        = string
  default     = "europe-west2"
}

variable "region_training" {
  description = "Region for GPU training VMs (better L4 stock than london per technical review)."
  type        = string
  default     = "europe-west4"
}

variable "zone_training" {
  description = "Zone for training GCE (set when enable_gpu_compute is true)."
  type        = string
  default     = "europe-west4-a"
}

variable "zone_serving" {
  description = "Zone for vLLM serving GCE (set when enable_gpu_compute is true)."
  type        = string
  default     = "europe-west2-a"
}

variable "data_bucket_suffix" {
  description = "Suffix for GCS bucket name: {project_id}-{suffix} must be globally unique."
  type        = string
  default     = "phase2-data"
}

variable "admin_cidr_blocks" {
  description = "CIDRs allowed to reach vLLM port 8000 when GPU compute is enabled (e.g. office IP / VPN). Empty = no vLLM ingress rule created."
  type        = list(string)
  default     = []
}

variable "enable_gpu_compute" {
  description = "When true, creates L4 GCE instances for training + vLLM (billable). Keep false until pause-after-g1 per spike plan."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to supported resources."
  type        = map(string)
  default = {
    app         = "sophia"
    environment = "phase2-spike"
  }
}
