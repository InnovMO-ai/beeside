# Database module (GCP) — Cloud SQL for PostgreSQL.
#
# This is the ONE canonical PostgreSQL database for the complete beeside
# project lifecycle (Technical Architecture v1.1 FINAL §1 principles 3-4, §2,
# §13; Correction 1: Precision RFI's future data extends this same database,
# never a separate one) — one instance per environment, never shared across
# environments, and exactly one canonical database per environment, not one
# per subsystem. This is a straight vendor swap from the AWS RDS module: same
# engine (PostgreSQL), same guarantees (automated backups + point-in-time
# recovery unconditionally on, per Technical Architecture v1.1 FINAL §14 —
# RPO <= 24h, RTO <= 8h).

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
  description = "Cloud SQL machine tier. Smallest shared-core for dev; a dedicated-core tier for staging/production."
  type        = string
  default     = "db-g1-small"
}

variable "availability_type" {
  description = "ZONAL (single zone, cheaper) or REGIONAL (HA, ~2x cost). ZONAL is the Phase 1 default everywhere except production."
  type        = string
  default     = "ZONAL"
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

resource "random_password" "master" {
  length  = 32
  special = false # Cloud SQL's own password policy already enforces complexity; avoiding shell-unsafe characters keeps the secret easy to consume everywhere.
}

resource "google_sql_database_instance" "canonical" {
  name             = "beeside-${var.environment}-canonical-db"
  database_version = "POSTGRES_16"
  region           = var.region

  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = min(var.backup_retention_days, 7) # Cloud SQL PITR log cap; retained backups (below) can exceed this.
      backup_retention_settings {
        retained_backups = var.backup_retention_days
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      # Public IP + IAM/password auth is the simplest, no-extra-cost path for
      # Phase 1 (avoids a paid Serverless VPC Access connector). Access is
      # still not "open": authorized_networks stays empty, so only Cloud
      # Run's managed Cloud SQL connector (Google-internal path, not the
      # public internet) and the Cloud SQL Auth Proxy from an authorized
      # operator machine can reach it.
      ipv4_enabled = true
      require_ssl  = true
    }
  }

  lifecycle {
    prevent_destroy = false # Phase 1 flexibility; revisit before Phase 15 production hardening.
  }
}

resource "google_sql_database" "beeside" {
  name     = "beeside"
  instance = google_sql_database_instance.canonical.name
}

resource "google_sql_user" "app" {
  name     = "beeside_app"
  instance = google_sql_database_instance.canonical.name
  password = random_password.master.result
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "beeside-${var.environment}-db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.master.result
}

output "instance_connection_name" {
  description = "Used by Cloud Run's built-in Cloud SQL integration (no VPC connector needed)."
  value       = google_sql_database_instance.canonical.connection_name
}

output "database_name" {
  value = google_sql_database.beeside.name
}

output "db_password_secret_id" {
  value = google_secret_manager_secret.db_password.secret_id
}
