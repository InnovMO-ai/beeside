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

variable "writer_service_accounts" {
  description = "Service account emails granted roles/artifactregistry.writer on this repository only (least-privilege: the CI/CD identity that pushes images here needs to push, nothing project-wide, and nothing on any other repository)."
  type        = list(string)
  default     = []
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "beeside-${var.environment}"
  format        = "DOCKER"
  description   = "beeside container images (backend, frontend) for the ${var.environment} environment."
}

# Workload Identity Federation (see envs/*/main.tf) lets GitHub Actions
# authenticate as the CI deploy service account, but authentication alone
# grants no permissions: without this binding `docker push` to this
# repository fails with `artifactregistry.repositories.uploadArtifacts
# denied`, since the service account otherwise holds no resource-level role
# at all.
resource "google_artifact_registry_repository_iam_member" "writers" {
  for_each   = toset(var.writer_service_accounts)
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${each.value}"
}

output "repository_id" {
  value = google_artifact_registry_repository.images.repository_id
}

output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${google_artifact_registry_repository.images.project}/${google_artifact_registry_repository.images.repository_id}"
}
