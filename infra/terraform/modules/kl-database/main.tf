# Knowledge Layer database module (GCP) — DEDICATED Cloud SQL instance for beeside_kl (CR-KL-002, option A).
#
# Why a dedicated instance: the G1 rehearsal (docs/knowledge-layer/kl-1.0-code/G1_G2_PLAN.md §9) showed that on Cloud SQL any
# member of cloudsqlsuperuser administers every non-superuser role in the instance (GRANT, SET ROLE, ALTER/DROP ROLE, DROP DATABASE),
# whether the role was created through the API, through SQL or as an IAM database user. The canonical beeside instance has two such
# principals in use (beeside_app, postgres), so beeside_kl cannot be isolated there. In this instance the ONLY cloudsqlsuperuser
# members are: the built-in postgres user (no password is ever set, so it cannot log in) and the one-shot kl_provisioner.
#
# NOT created here, on purpose:
#   - google_sql_user for kl_owner / kl_app / kl_reader_precision / kl_agent / kl_knowledge. Users created through the API join
#     cloudsqlsuperuser and get CREATEROLE/CREATEDB. The roles are created by SQL (backend/src/kl/db/bootstrap/roles.sql) as
#     NOSUPERUSER NOCREATEROLE NOCREATEDB; only their passwords/secrets are managed here.
#   - the beeside_kl database itself: it must be created WITH OWNER kl_owner, so it is created by the provisioning step.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "tier" {
  description = "Cloud SQL machine tier. db-g1-small is the dev default (same as the canonical dev instance)."
  type        = string
  default     = "db-g1-small"
}

variable "availability_type" {
  type    = string
  default = "ZONAL"
}

variable "disk_size_gb" {
  type    = number
  default = 10
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  description = "True by default: this instance holds the KL corpus. Flip to false (and apply) only to tear it down."
  type        = bool
  default     = true
}

variable "provisioner_enabled" {
  description = "Phase 1 of the provisioning runbook: creates the one-shot kl_provisioner API user. Set back to false right after the roles and beeside_kl exist, so the user (and its cloudsqlsuperuser membership) is deleted."
  type        = bool
  default     = false
}

variable "backup_start_time" {
  description = "UTC HH:MM."
  type        = string
  default     = "08:00"
}

locals {
  kl_roles = ["kl_owner", "kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"]
}

resource "google_sql_database_instance" "kl" {
  name             = "beeside-${var.environment}-kl-db"
  database_version = "POSTGRES_16"
  region           = var.region

  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    edition           = "ENTERPRISE"
    availability_type = var.availability_type
    disk_size         = var.disk_size_gb
    disk_autoresize   = true

    user_labels = {
      platform    = "knowledge-layer"
      environment = var.environment
    }

    backup_configuration {
      enabled                        = true
      start_time                     = var.backup_start_time
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = min(var.backup_retention_days, 7)
      backup_retention_settings {
        retained_backups = var.backup_retention_days
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      # Same access model as the canonical instance: public IP with no authorized networks; only Cloud Run's managed
      # connector and the Cloud SQL Auth Proxy (operator) can reach it, and client certificates are required.
      ipv4_enabled = true
      require_ssl  = true # provider 5.x sends require_ssl=false unless set; it must agree with ssl_mode
      ssl_mode     = "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    }

    insights_config {
      query_insights_enabled = false
    }
  }

  lifecycle {
    prevent_destroy = false
  }
}

# One-shot provisioning identity (runbook step 2). Created and deleted by flipping provisioner_enabled; its password lives only in
# the secret below, readable only by the operator account that runs the provisioning.
resource "random_password" "provisioner" {
  count   = var.provisioner_enabled ? 1 : 0
  length  = 32
  special = false
}

resource "google_sql_user" "provisioner" {
  count    = var.provisioner_enabled ? 1 : 0
  name     = "kl_provisioner"
  instance = google_sql_database_instance.kl.name
  password = random_password.provisioner[0].result
}

resource "google_secret_manager_secret" "provisioner_password" {
  count     = var.provisioner_enabled ? 1 : 0
  secret_id = "beeside-${var.environment}-kl-provisioner-password"
  labels    = { platform = "knowledge-layer", purpose = "one-shot-provisioning" }
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "provisioner_password" {
  count       = var.provisioner_enabled ? 1 : 0
  secret      = google_secret_manager_secret.provisioner_password[0].id
  secret_data = random_password.provisioner[0].result
}

# One password per KL role. The roles themselves are created by SQL; the provisioning step reads these secrets to set the passwords.
resource "random_password" "role" {
  for_each = toset(local.kl_roles)
  length   = 32
  special  = false # hex-safe for the connection string below
}

resource "google_secret_manager_secret" "role_url" {
  for_each  = toset(local.kl_roles)
  secret_id = "beeside-${var.environment}-${replace(each.key, "_", "-")}-url"
  labels    = { platform = "knowledge-layer", role = replace(each.key, "_", "-") }
  replication {
    auto {}
  }
}

# Connection string in the shape the KL code reads (KL_DB_URL_*): Cloud Run's /cloudsql unix socket, database beeside_kl.
resource "google_secret_manager_secret_version" "role_url" {
  for_each    = toset(local.kl_roles)
  secret      = google_secret_manager_secret.role_url[each.key].id
  secret_data = "postgresql://${each.key}:${random_password.role[each.key].result}@/beeside_kl?host=/cloudsql/${google_sql_database_instance.kl.connection_name}"
}

output "instance_name" {
  value = google_sql_database_instance.kl.name
}

output "instance_connection_name" {
  value = google_sql_database_instance.kl.connection_name
}

output "instance_service_account" {
  description = "Cloud SQL's own service account: needs write access to the exports bucket for logical exports."
  value       = google_sql_database_instance.kl.service_account_email_address
}

output "role_secret_ids" {
  description = "kl_owner -> secret id, etc. Consumers get access per secret (CR-KL-002 §7, X26/X27)."
  value       = { for r in local.kl_roles : r => google_secret_manager_secret.role_url[r].secret_id }
}

output "provisioner_secret_id" {
  value = var.provisioner_enabled ? google_secret_manager_secret.provisioner_password[0].secret_id : null
}
