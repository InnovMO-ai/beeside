# staging environment — root module (GCP). Structurally identical to
# dev/production by design (same modules, same shape) so "does it work in
# staging" reliably predicts "will it work in production."

terraform {
  required_version = ">= 1.7"

  backend "gcs" {
    bucket = "REPLACE-WITH-beeside-terraform-state-staging"
    prefix = "staging"
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
  description = "The GCP project for the staging environment, e.g. beeside-staging-<random-suffix>."
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
  environment = "staging"
  region      = var.region
  subnet_cidr = "10.20.0.0/20" # deliberately non-overlapping with dev (10.10.0.0/20) and production
  depends_on  = [google_project_service.apis]
}

module "artifact_registry" {
  source      = "../../modules/artifact-registry"
  environment = "staging"
  region      = var.region
  depends_on  = [google_project_service.apis]
}

module "secrets" {
  source      = "../../modules/secrets"
  environment = "staging"
  depends_on  = [google_project_service.apis]
}

module "database" {
  source                = "../../modules/database"
  environment            = "staging"
  region                 = var.region
  tier                   = "db-custom-1-3840" # a real dedicated-core tier, unlike dev's shared-core — this is where "does the real thing hold up" gets tested
  availability_type      = "ZONAL"            # single-zone is a deliberate cost choice for Phase 1; revisit before production traffic depends on staging fidelity
  backup_retention_days  = 14
  deletion_protection    = true
  depends_on             = [google_project_service.apis]
}

module "backend_service" {
  source                             = "../../modules/cloud-run"
  environment                        = "staging"
  region                             = var.region
  service_name                       = "backend-api"
  cloudsql_instance_connection_name  = module.database.instance_connection_name
  allow_unauthenticated              = true
}

module "frontend_service" {
  source                = "../../modules/cloud-run"
  environment           = "staging"
  region                = var.region
  service_name          = "frontend-app"
  allow_unauthenticated = true
}

resource "google_service_account" "ci_deployer" {
  account_id   = "beeside-staging-ci-deployer"
  display_name = "beeside staging — GitHub Actions deploy identity"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "beeside-staging-github-pool"
  display_name              = "GitHub Actions (staging)"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == 'InnovMO-ai/beeside'"

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
