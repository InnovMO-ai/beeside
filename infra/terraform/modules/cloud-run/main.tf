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
  description = "Documents intent only (true for the frontend app and the backend's public health-check) - this module does not act on it. Two mechanisms were tried and rejected: granting roles/run.invoker to allUsers (envs/dev/public-access-tag-policy.tf, retired - fails outright under this project's Domain Restricted Sharing org policy, regardless of propagation delay, matching Google's own guidance that allUsers is not the supported path under DRS); and the run.googleapis.com/invoker-iam-disabled annotation (rejected outright by the Cloud Run v2 API itself: \"system annotations are not supported in Cloud Run API v2\" - that mechanism is v1-only). The v2-native replacement, invoker_iam_disabled as a typed field on google_cloud_run_v2_service, does not exist in any hashicorp/google provider version as of this writing (open upstream issue, no released fix) - see docs/deployment/README.md. Until it lands, both dev services have the invoker IAM check disabled directly via `gcloud run deploy ... --no-invoker-iam-check` in deploy-dev.yml. Domain Restricted Sharing itself is never touched by this - no org-policy exception, no allUsers grant, nothing project-level."
  type    = bool
  default = true
}

variable "deployer_service_accounts" {
  description = "Service account emails granted roles/run.developer on this specific Cloud Run service only (least-privilege: the CI/CD identity that deploys new revisions here, nothing project-wide, and nothing on any other service)."
  type        = list(string)
  default     = []
}

resource "google_cloud_run_v2_service" "this" {
  name     = "beeside-${var.environment}-${var.service_name}"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # No annotations block here: the Cloud Run v2 API rejects
  # run.googleapis.com/* system annotations outright ("system annotations
  # are not supported in Cloud Run API v2"), and google_cloud_run_v2_service
  # has no typed invoker_iam_disabled field in any current provider version.
  # See the allow_unauthenticated variable above and
  # docs/deployment/README.md for how public access is actually granted
  # today (gcloud, outside Terraform, until provider support lands).

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
    #
    # Same reasoning for env: `gcloud run deploy`/`services update` calls
    # made directly against this service (outside Terraform, e.g. while
    # docs/deployment's runtime env vars are wired in ahead of Terraform
    # managing them) set values this resource does not declare. Without
    # ignoring drift here too, the next `terraform apply` would plan to
    # strip every one of those live values back down to just NODE_ENV —
    # exactly the risk that blocked applying the IAM changes safely.
    # Terraform still fully owns env on the very first create of a service.
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
    ]
  }
}

# Workload Identity Federation (see envs/*/main.tf) lets GitHub Actions
# authenticate as the CI deploy service account, but authentication alone
# grants no permissions: without this binding `gcloud run deploy` against
# this service fails with a permission-denied error, since the service
# account otherwise holds no resource-level role at all.
resource "google_cloud_run_v2_service_iam_member" "deployers" {
  for_each = toset(var.deployer_service_accounts)
  name     = google_cloud_run_v2_service.this.name
  location = google_cloud_run_v2_service.this.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${each.value}"
}

output "url" {
  value = google_cloud_run_v2_service.this.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.this.name
}
