# Migration job module (GCP) — Cloud Run Job dedicated to database migrations.
#
# Runs the backend image's own `node dist/scripts/migrate.js` entrypoint as a
# one-shot job, never a long-lived service: it has no ingress and no public
# endpoint at all (Cloud Run Jobs are not request-serving, unlike the
# services in modules/cloud-run). It reaches the same canonical Cloud SQL
# instance as the backend service, through Cloud Run's built-in Cloud SQL
# connector, but under its own minimal identity — never the backend
# service's — and it only ever receives the migration connection string
# (modules/database's migration_database_url secret, built from the existing
# migration user, `beeside_app`), never a runtime-service credential.
#
# docs/deployment/README.md documents the full intended privilege-separation
# end state (a separate low-privilege `beeside_runtime` login role, still an
# open decision). Nothing here depends on that decision or blocks it: this
# module only wires the piece docs/deployment/README.md already lists as
# "still missing (infrastructure, not code)" — the job itself — using the
# migration user that already exists today.

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

variable "project_id" {
  type = string
}

variable "cloudsql_instance_connection_name" {
  description = "modules/database's instance_connection_name output — the same canonical Cloud SQL instance the backend service connects to."
  type        = string
}

variable "migration_database_url_secret_id" {
  description = "Secret Manager secret id (modules/database's migration_database_url output) holding the full migration-user (beeside_app) connection string. This job is granted read access to exactly this one secret and nothing else."
  type        = string
}

variable "placeholder_image" {
  description = "Terraform needs some image to create the job with; CI overwrites it on every deploy with the backend image built for that commit (see the ignore_changes below, mirroring modules/cloud-run)."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "deployer_service_accounts" {
  description = "Service account emails granted roles/run.developer on this specific job only (least-privilege: the CI/CD identity that updates its image and executes it, nothing project-wide, and nothing on any other Cloud Run resource)."
  type        = list(string)
  default     = []
}

# The job's own runtime identity — deliberately separate from the backend
# and frontend services (which currently run under the project's default
# compute identity). This one exists for a single purpose and is granted
# only what that purpose requires: reach Cloud SQL, read one secret.
resource "google_service_account" "migration_runner" {
  account_id   = "beeside-${var.environment}-migration-runner"
  display_name = "beeside ${var.environment} — database migration job runtime identity"
}

# Required for Cloud Run's built-in Cloud SQL connector (the volumes/mount
# below) to work at all. Cloud SQL has no resource-level IAM binding for
# this role — roles/cloudsql.client is only ever grantable at the project —
# so project scope here is the least-privilege ceiling GCP offers, not a
# broadening choice; the *identity* it's granted to is still scoped to just
# this one job.
resource "google_project_iam_member" "migration_runner_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migration_runner.email}"
}

# Resource-scoped: read access to exactly the one secret this job needs,
# never a project-wide secret grant.
resource "google_secret_manager_secret_iam_member" "migration_runner_secret_access" {
  secret_id = var.migration_database_url_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migration_runner.email}"
}

resource "google_cloud_run_v2_job" "migrate" {
  name     = "beeside-${var.environment}-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.migration_runner.email
      max_retries      = 0 # a failed migration must stop the deploy pipeline (deploy-dev.yml runs it with --wait), never silently retry against a partially-applied schema

      containers {
        image   = var.placeholder_image
        command = ["node"]
        args    = ["dist/scripts/migrate.js"]

        env {
          name = "MIGRATION_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.migration_database_url_secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.cloudsql_instance_connection_name]
        }
      }
    }
  }

  lifecycle {
    # Mirrors modules/cloud-run: CI (`gcloud run jobs update --image ...` in
    # deploy-dev.yml) is authoritative for the image on every deploy; without
    # this, the next `terraform apply` would silently revert it back to the
    # placeholder image.
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }
}

# Same pattern as modules/cloud-run's "deployers": authentication (Workload
# Identity Federation, in envs/*/main.tf) grants no permission by itself —
# without this binding, `gcloud run jobs update`/`execute` against this job
# fails with permission-denied.
resource "google_cloud_run_v2_job_iam_member" "deployers" {
  for_each = toset(var.deployer_service_accounts)
  name     = google_cloud_run_v2_job.migrate.name
  location = google_cloud_run_v2_job.migrate.location
  role     = "roles/run.developer"
  member   = "serviceAccount:${each.value}"
}

# roles/run.developer alone is not sufficient: this job runs as a
# non-default service account (migration_runner, above), and GCP requires
# the deploying identity to hold iam.serviceAccountUser on whatever service
# account a revision/execution will run as, checked on every
# `gcloud run jobs update` (it creates a new job revision), not only at
# first creation. Scoped to this one service account only — never
# project-wide iam.serviceAccountUser, which would let the deployer
# impersonate every service account in the project.
resource "google_service_account_iam_member" "deployers_can_act_as_migration_runner" {
  for_each            = toset(var.deployer_service_accounts)
  service_account_id  = google_service_account.migration_runner.name
  role                = "roles/iam.serviceAccountUser"
  member              = "serviceAccount:${each.value}"
}

output "job_name" {
  value = google_cloud_run_v2_job.migrate.name
}
