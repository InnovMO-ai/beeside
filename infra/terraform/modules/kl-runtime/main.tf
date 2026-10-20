# Knowledge Layer runtime module (GCP): identities, secret access, buckets, Cloud Run Jobs and schedules for KL (CR-KL-002 §7, §10).
#
# Nothing here touches the canonical beeside instance, its secrets, or the migration-runner / compute identities' grants on them.
# Every KL job has its OWN service account; each secret is bound per secret (no project-wide secretAccessor).
#
# Deliberately NOT included (separate approvals): kl-bootstrap job (needs the platform read credential, CR-KL-002 §5),
# network egress control / NAT / firewall policy (G3), the backend service's KL environment variables (set with `gcloud run services
# update`, because modules/cloud-run ignores env drift), agents and any external traffic.

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

variable "instance_name" {
  type = string
}

variable "instance_connection_name" {
  type = string
}

variable "instance_service_account" {
  description = "Cloud SQL's own service account (from modules/kl-database), which writes the logical exports."
  type        = string
}

variable "role_secret_ids" {
  description = "kl_owner|kl_app|kl_reader_precision|kl_agent|kl_knowledge -> Secret Manager secret id."
  type        = map(string)
}

variable "backend_service_account" {
  description = "Runtime identity of beeside-<env>-backend-api. Today the project's default compute account, which is SHARED with the fa4 services (decision D3: a dedicated account is recommended). It receives ONLY kl_app and kl_reader_precision and read of published editions."
  type        = string
}

variable "placeholder_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "deployer_service_accounts" {
  description = "CI identity that may update/execute the KL jobs (run.developer on each job and serviceAccountUser on its runtime account only)."
  type        = list(string)
  default     = []
}

variable "worker_memory" {
  description = "Chromium needs headroom."
  type        = string
  default     = "2Gi"
}

variable "store_retention_days" {
  description = "Retention (not locked) on the store bucket, for originals and published PDFs. 0 = none."
  type        = number
  default     = 30
}

variable "export_versions_to_keep" {
  type    = number
  default = 35
}

variable "scheduler_enabled" {
  description = "Creates the schedules (and needs cloudscheduler.googleapis.com enabled, decision D9). Off by default."
  type        = bool
  default     = false
}

variable "scheduler_region" {
  description = "Cloud Scheduler is not available in northamerica-south1 (Querétaro); the schedule can live in another region because the targets are HTTPS APIs. us-south1 (Dallas) is the closest supported region."
  type        = string
  default     = "us-south1"
}

variable "scheduler_paused" {
  description = "Schedules are created paused; unpausing is a separate, explicit act."
  type        = bool
  default     = true
}

locals {
  prefix = "beeside-${var.environment}-kl"
}

# --- identities ------------------------------------------------------------------------------------------------------------
resource "google_service_account" "migrate" {
  account_id   = "${local.prefix}-migrate"
  display_name = "KL ${var.environment} — kl-migrate job (kl_owner only)"
}

resource "google_service_account" "worker" {
  account_id   = "${local.prefix}-worker"
  display_name = "KL ${var.environment} — kl-worker job (kl_agent and kl_knowledge only)"
}

resource "google_service_account" "scheduler" {
  account_id   = "${local.prefix}-scheduler"
  display_name = "KL ${var.environment} — Cloud Scheduler caller (run kl-worker, export beeside_kl)"
}

# roles/cloudsql.client is only grantable at project level (same constraint as modules/migration-job); the identities are scoped.
resource "google_project_iam_member" "cloudsql_client" {
  for_each = {
    migrate = google_service_account.migrate.email
    worker  = google_service_account.worker.email
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

# --- secret access, per secret ---------------------------------------------------------------------------------------------
locals {
  secret_grants = {
    "migrate-owner"    = { secret = var.role_secret_ids["kl_owner"], member = google_service_account.migrate.email }
    "worker-agent"     = { secret = var.role_secret_ids["kl_agent"], member = google_service_account.worker.email }
    "worker-knowledge" = { secret = var.role_secret_ids["kl_knowledge"], member = google_service_account.worker.email }
    "backend-app"      = { secret = var.role_secret_ids["kl_app"], member = var.backend_service_account }
    "backend-reader"   = { secret = var.role_secret_ids["kl_reader_precision"], member = var.backend_service_account }
  }
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = local.secret_grants
  secret_id = each.value.secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value.member}"
}

# --- buckets ---------------------------------------------------------------------------------------------------------------
resource "google_storage_bucket" "store" {
  name                        = "${var.project_id}-${local.prefix}-store"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  dynamic "retention_policy" {
    for_each = var.store_retention_days > 0 ? [1] : []
    content {
      retention_period = var.store_retention_days * 86400
      is_locked        = false
    }
  }

  labels = { platform = "knowledge-layer" }
}

resource "google_storage_bucket" "exports" {
  name                        = "${var.project_id}-${local.prefix}-exports"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = var.export_versions_to_keep
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = { platform = "knowledge-layer" }
}

# The worker creates objects (originals, previews, editions) and reads them back; nothing broader.
resource "google_storage_bucket_iam_member" "worker_create" {
  bucket = google_storage_bucket.store.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "worker_view" {
  bucket = google_storage_bucket.store.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# The backend only READS: published editions (openEdition, kl/editions/) and the admin preview PDFs (kl/previews/); never originals (kl/objects/).
resource "google_storage_bucket_iam_member" "backend_editions_view" {
  bucket = google_storage_bucket.store.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${var.backend_service_account}"

  condition {
    title      = "kl-editions-and-previews-only"
    expression = "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.store.name}/objects/kl/editions/\") || resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.store.name}/objects/kl/previews/\")"
  }
}

# Cloud SQL writes the logical export with its own service account.
resource "google_storage_bucket_iam_member" "sql_export_writer" {
  bucket = google_storage_bucket.exports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.instance_service_account}"
}

# --- Cloud Run Jobs --------------------------------------------------------------------------------------------------------
resource "google_cloud_run_v2_job" "migrate" {
  name     = "${local.prefix}-migrate"
  location = var.region

  depends_on = [
    google_secret_manager_secret_iam_member.access,
    google_project_iam_member.cloudsql_client,
  ]

  template {
    template {
      service_account = google_service_account.migrate.email
      max_retries     = 0 # a failed migration must stop, never retry against a partially applied schema
      timeout         = "900s"

      containers {
        image   = var.placeholder_image
        command = ["node"]
        args    = ["dist/kl/db/migrate-cli.js"]

        env {
          name = "KL_DB_URL_OWNER"
          value_source {
            secret_key_ref {
              secret  = var.role_secret_ids["kl_owner"]
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
          instances = [var.instance_connection_name]
        }
      }
    }
  }

  lifecycle {
    # image and the gcloud client markers are set by `gcloud run jobs update` (kl-publish-images workflow / operator), not by Terraform
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_job" "worker" {
  name     = "${local.prefix}-worker"
  location = var.region

  depends_on = [
    google_secret_manager_secret_iam_member.access,
    google_project_iam_member.cloudsql_client,
  ]

  template {
    template {
      service_account = google_service_account.worker.email
      max_retries     = 1
      timeout         = "600s"

      containers {
        image   = var.placeholder_image
        command = ["node"]
        args    = ["dist/kl/worker/kl-worker.js"]

        resources {
          limits = {
            cpu    = "1"
            memory = var.worker_memory
          }
        }

        env {
          name  = "NODE_ENV"
          value = var.environment == "dev" ? "development" : var.environment
        }
        env {
          name  = "KL_RENDER_ENABLED"
          value = "true"
        }
        env {
          name  = "KL_AGENTS_ENABLED"
          value = "false"
        }
        env {
          name  = "PRECISION_KNOWLEDGE_PROVIDER"
          value = "off"
        }
        # Development-only local object store (NODE_ENV != production): the image's working directory is read-only for the `node` user, so the
        # default ./.kl-storage cannot be created. /tmp is writable (in-memory) and ephemeral; it is NOT a place to publish editions (decision D8).
        env {
          name  = "KL_STORAGE_DIR"
          value = "/tmp/kl-storage"
        }
        # Consumed by the Cloud Storage ObjectStore, which is NOT implemented yet (decision D8): documented so the wiring is ready.
        env {
          name  = "KL_STORE_BUCKET"
          value = google_storage_bucket.store.name
        }
        env {
          name = "KL_DB_URL_AGENT"
          value_source {
            secret_key_ref {
              secret  = var.role_secret_ids["kl_agent"]
              version = "latest"
            }
          }
        }
        env {
          name = "KL_DB_URL_KNOWLEDGE"
          value_source {
            secret_key_ref {
              secret  = var.role_secret_ids["kl_knowledge"]
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
          instances = [var.instance_connection_name]
        }
      }
    }
  }

  lifecycle {
    # image and the gcloud client markers are set by `gcloud run jobs update` (kl-publish-images workflow / operator), not by Terraform
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_job_iam_member" "deployers" {
  for_each = {
    for pair in setproduct(["migrate", "worker"], var.deployer_service_accounts) : "${pair[0]}-${pair[1]}" => { job = pair[0], sa = pair[1] }
  }
  name     = each.value.job == "migrate" ? google_cloud_run_v2_job.migrate.name : google_cloud_run_v2_job.worker.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${each.value.sa}"
}

resource "google_service_account_iam_member" "deployers_act_as" {
  for_each = {
    for pair in setproduct(["migrate", "worker"], var.deployer_service_accounts) : "${pair[0]}-${pair[1]}" => { job = pair[0], sa = pair[1] }
  }
  service_account_id = each.value.job == "migrate" ? google_service_account.migrate.name : google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${each.value.sa}"
}

# --- schedules (off by default, created paused) ----------------------------------------------------------------------------
resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_worker" {
  count    = var.scheduler_enabled ? 1 : 0
  name     = google_cloud_run_v2_job.worker.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Least privilege for the export call: a custom role with the single permission the Admin API checks.
resource "google_project_iam_custom_role" "kl_export" {
  count       = var.scheduler_enabled ? 1 : 0
  role_id     = "klExportOnly${title(var.environment)}"
  title       = "KL logical export only (${var.environment})"
  description = "cloudsql.instances.export for the KL scheduler on the dedicated KL instance."
  permissions = ["cloudsql.instances.export"]
}

resource "google_project_iam_member" "scheduler_export" {
  count   = var.scheduler_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.kl_export[0].id
  member  = "serviceAccount:${google_service_account.scheduler.email}"

  condition {
    title      = "kl-instance-only"
    expression = "resource.name == \"projects/${var.project_id}/instances/${var.instance_name}\""
  }
}

resource "google_cloud_scheduler_job" "worker_tick" {
  count     = var.scheduler_enabled ? 1 : 0
  name      = "${local.prefix}-worker-tick"
  region    = var.scheduler_region
  schedule  = "*/5 * * * *"
  time_zone = "Etc/UTC"
  paused    = var.scheduler_paused

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.worker.name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
}

# Daily logical export of beeside_kl (CR-KL-002 §10). The object name is fixed; bucket versioning keeps the history.
resource "google_cloud_scheduler_job" "daily_export" {
  count     = var.scheduler_enabled ? 1 : 0
  name      = "${local.prefix}-daily-export"
  region    = var.scheduler_region
  schedule  = "30 8 * * *"
  time_zone = "Etc/UTC"
  paused    = var.scheduler_paused

  http_target {
    http_method = "POST"
    uri         = "https://sqladmin.googleapis.com/v1/projects/${var.project_id}/instances/${var.instance_name}/export"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      exportContext = {
        fileType  = "SQL"
        uri       = "gs://${google_storage_bucket.exports.name}/daily/beeside_kl.sql.gz"
        databases = ["beeside_kl"]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
}

output "migrate_job_name" {
  value = google_cloud_run_v2_job.migrate.name
}

output "worker_job_name" {
  value = google_cloud_run_v2_job.worker.name
}

output "store_bucket" {
  value = google_storage_bucket.store.name
}

output "exports_bucket" {
  value = google_storage_bucket.exports.name
}

output "migrate_service_account" {
  value = google_service_account.migrate.email
}

output "worker_service_account" {
  value = google_service_account.worker.email
}
