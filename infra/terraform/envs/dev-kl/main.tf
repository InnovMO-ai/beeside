# Knowledge Layer — dev root module (GCP). PREPARED, NOT APPLIED. Approval to prepare: PO, option A of G1_G2_PLAN.md §9.
#
# A separate root with its OWN state (prefix "dev-kl" in the same state bucket) so that nothing in envs/dev (Discovery, Precision, FA4)
# is planned, changed or destroyed by KL. It only READS existing project facts (default compute account, project number) and creates
# new resources: a dedicated Cloud SQL instance (beeside-dev-kl-db), KL service accounts, secrets, buckets, Cloud Run Jobs and,
# optionally, paused schedules.
#
# Runbook: docs/knowledge-layer/kl-1.0-code/G1_G2_PLAN.md §5 and infra/terraform/envs/dev-kl/RUNBOOK.md

terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "beeside-terraform-state-dev-508220"
    prefix = "dev-kl"
  }

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

variable "project_id" {
  type    = string
  default = "beeside-dev-508220"
}

variable "region" {
  type    = string
  default = "northamerica-south1"
}

variable "provisioner_enabled" {
  description = "Runbook phase 1 only. true while the one-shot kl_provisioner exists; back to false afterwards."
  type        = bool
  default     = false
}

variable "scheduler_enabled" {
  description = "Decision D9: also enables cloudscheduler.googleapis.com. Off by default."
  type        = bool
  default     = false
}

variable "scheduler_paused" {
  type    = bool
  default = true
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "tier" {
  type    = string
  default = "db-g1-small"
}

variable "backend_service_account" {
  description = "Runtime identity of beeside-dev-backend-api. null = the project's default compute account (today's reality, shared with fa4 services; decision D3 recommends a dedicated one)."
  type        = string
  default     = null
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_compute_default_service_account" "default" {}

locals {
  backend_sa  = coalesce(var.backend_service_account, data.google_compute_default_service_account.default.email)
  ci_deployer = "beeside-dev-ci-deployer@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_service" "scheduler" {
  count              = var.scheduler_enabled ? 1 : 0
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

module "kl_database" {
  source              = "../../modules/kl-database"
  environment         = "dev"
  region              = var.region
  tier                = var.tier
  deletion_protection = var.deletion_protection
  provisioner_enabled = var.provisioner_enabled
}

module "kl_runtime" {
  source                    = "../../modules/kl-runtime"
  environment               = "dev"
  region                    = var.region
  project_id                = var.project_id
  instance_name             = module.kl_database.instance_name
  instance_connection_name  = module.kl_database.instance_connection_name
  instance_service_account  = module.kl_database.instance_service_account
  role_secret_ids           = module.kl_database.role_secret_ids
  backend_service_account   = local.backend_sa
  deployer_service_accounts = [local.ci_deployer]
  scheduler_enabled         = var.scheduler_enabled
  scheduler_paused          = var.scheduler_paused

  depends_on = [google_project_service.scheduler]
}

output "kl_instance_connection_name" {
  value = module.kl_database.instance_connection_name
}

output "kl_migrate_job" {
  value = module.kl_runtime.migrate_job_name
}

output "kl_worker_job" {
  value = module.kl_runtime.worker_job_name
}

output "kl_store_bucket" {
  value = module.kl_runtime.store_bucket
}

output "kl_exports_bucket" {
  value = module.kl_runtime.exports_bucket
}

output "kl_provisioner_secret" {
  value = module.kl_database.provisioner_secret_id
}
