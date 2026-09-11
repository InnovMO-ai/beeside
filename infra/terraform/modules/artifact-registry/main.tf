# Artifact Registry module (GCP) — new in the GCP translation.
#
# AWS's equivalent (ECR) was never made explicit in the original scaffold
# because the AWS deploy steps were left as placeholders. Now that GCP is the
# confirmed target, this is required alongside Cloud Run: Cloud Run deploys a
# container image, and this is where CI pushes the backend/frontend images it
# builds. One repository per environment, matching the per-environment
# GCP-project isolation used throughout this scaffold.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "beeside-${var.environment}"
  format        = "DOCKER"
  description   = "beeside container images (backend, frontend) for the ${var.environment} environment."
}

output "repository_id" {
  value = google_artifact_registry_repository.images.repository_id
}

output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${google_artifact_registry_repository.images.project}/${google_artifact_registry_repository.images.repository_id}"
}
