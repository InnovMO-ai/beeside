# Cloud Run module (GCP) — new in the GCP translation.
#
# The original AWS scaffold never named a compute target; its CI/CD deploy
# steps were explicit placeholders ("push to a live target" left unwired).
# Cloud Run is the direct GCP equivalent of that unnamed target: a serverless
# container platform that scales to zero (near-$0 cost while idle, which is
# exactly this Phase 1 health-check service's traffic profile) and needs no
# cluster to manage. This module is generic and instantiated twice per
# environment — once for the backend API, once for the frontend static app —
# so the same reviewed definition serves both.

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

variable "service_name" {
  description = "e.g. \"backend-api\" or \"frontend-app\""
  type        = string
}

variable "placeholder_image" {
  description = "A real image is pushed by CI after the first successful build; Terraform needs some image to create the service with, so it starts from Google's public sample container."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "cloudsql_instance_connection_name" {
  description = "Set only for the backend service. Enables Cloud Run's built-in Cloud SQL proxy — no VPC connector required."
  type        = string
  default     = null
}

variable "min_instances" {
  description = "0 = scales fully to zero between requests (cheapest; a small cold-start delay on the first request after idle). Kept at 0 everywhere in Phase 1."
  type        = number
  default     = 0
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "allow_unauthenticated" {
  description = "Documents intent only (true for the frontend app and the backend's public health-check). The module itself no longer grants roles/run.invoker to allUsers based on this flag: in a project where public IAM bindings require a conditional org-policy exception (see envs/dev/public-access-tag-policy.tf), the binding must live at the root, outside this shared module, so it can carry an explicit depends_on the policy and its tag binding without creating a dependency cycle back onto this module. An environment that does not need such an exception (no Domain Restricted Sharing, or an equivalent already-permissive org policy) would instead grant this directly against module.<name>.service_name/location at its own root."
  type    = bool
  default = true
}

resource "google_cloud_run_v2_service" "this" {
  name     = "beeside-${var.environment}-${var.service_name}"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      env {
        name  = "NODE_ENV"
        value = var.environment == "dev" ? "development" : var.environment
      }

      # Mirrors the "volumes" block below one-for-one: when a Cloud SQL
      # instance is wired in, the container must explicitly mount it.
      # Without this, Cloud Run's own API silently adds this exact mount
      # server-side on create, and every subsequent `terraform plan` then
      # shows a spurious diff trying to remove it, since the .tf never
      # declared it in the first place.
      dynamic "volume_mounts" {
        for_each = var.cloudsql_instance_connection_name == null ? [] : [1]
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }

    dynamic "vpc_access" {
      for_each = [] # not used while Cloud SQL is reached via the built-in connector below
      content {}
    }

    dynamic "volumes" {
      for_each = var.cloudsql_instance_connection_name == null ? [] : [1]
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.cloudsql_instance_connection_name]
        }
      }
    }
  }

  lifecycle {
    # Terraform creates the service pointing at the placeholder image; every
    # deploy after that is `gcloud run deploy` (or an equivalent CI step)
    # updating the image directly. Without this, the next `terraform apply`
    # would silently revert a real deploy back to the placeholder image.
    ignore_changes = [template[0].containers[0].image]
  }
}

output "url" {
  value = google_cloud_run_v2_service.this.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.this.name
}
