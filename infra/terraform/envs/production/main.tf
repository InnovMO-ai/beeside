# production environment — root module (GCP).
#
# deletion_protection is unconditionally true; skip/final-snapshot handling
# is Cloud SQL's own automated-backup default (see modules/database) — nothing
# in this file may relax either the way dev's does. Phase 15's restore-drill
# and go/no-go review are the gate before this environment ever receives real
# client data. Per Mike's instruction, no resource in this file is created
# until explicitly approved — production is scaffolded now only so the code
# is complete and reviewable, not to be applied early.

terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "REPLACE-WITH-beeside-terraform-state-production"
    prefix = "production"
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
  description = "The GCP project for the production environment, e.g. beeside-production-<random-suffix>."
  type        = string
}

variable "region" {
  type    = string
  default = "northamerica-south1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enables every Google Cloud API this environment needs, the moment this
# environment is actually stood up — nothing to click through manually.
# Per Mike's instruction, production stays an empty project shell (this file
# is not applied) until explicitly approved later.
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "sqladmin.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "storage.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

module "network" {
  source      = "../../modules/network"
  environment = "production"
  region      = var.region
  subnet_cidr = "10.30.0.0/20" # deliberately non-overlapping with dev/staging
  depends_on  = [google_project_service.apis]
}

module "artifact_registry" {
  source      = "../../modules/artifact-registry"
  environment = "production"
  region      = var.region
  depends_on  = [google_project_service.apis]
}

module "secrets" {
  source      = "../../modules/secrets"
  environment = "production"
  depends_on  = [google_project_service.apis]
}

module "database" {
  source                = "../../modules/database"
  environment            = "production"
  region                 = var.region
  tier                   = "db-custom-2-7680"
  availability_type      = "REGIONAL" # HA — the one place this Phase 1 scaffold spends more for resilience by default
  backup_retention_days  = 35         # comfortably exceeds the RPO <= 24h floor (Technical Architecture v1.1 FINAL §14)
  deletion_protection    = true
  depends_on             = [google_project_service.apis]
}

module "backend_service" {
  source                             = "../../modules/cloud-run"
  environment                        = "production"
  region                             = var.region
  service_name                       = "backend-api"
  cloudsql_instance_connection_name  = module.database.instance_connection_name
  allow_unauthenticated              = true
  min_instances                      = 0 # revisit before real launch traffic if cold starts prove disruptive (Phase 15)
}

module "frontend_service" {
  source                = "../../modules/cloud-run"
  environment           = "production"
  region                = var.region
  service_name          = "frontend-app"
  allow_unauthenticated = true
}

resource "google_service_account" "ci_deployer" {
  account_id   = "beeside-prod-ci-deployer"
  display_name = "beeside production — GitHub Actions deploy identity"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "beeside-prod-github-pool"
  display_name              = "GitHub Actions (production)"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Production additionally restricts to the main branch, not just the repo,
  # so no feature-branch workflow run can ever assume this identity.
  attribute_condition = "assertion.repository == 'InnovMO-ai/beeside' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "ci_deployer_wif" {
  service_account_id = google_service_account.ci_deployer.name
  role                = "roles/iam.workloadIdentityUser"
  member              = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/InnovMO-ai/beeside"
}

output "vpc_id" {
  value = module.network.network_id
}

output "database_connection_name" {
  value = module.database.instance_connection_name
}

output "backend_url" {
  value = module.backend_service.url
}

output "frontend_url" {
  value = module.frontend_service.url
}
