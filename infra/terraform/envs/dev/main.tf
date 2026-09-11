# dev environment — root module (GCP).
#
# Each environment is its OWN GCP project — a stronger isolation boundary
# than the AWS scaffold's "one account, three VPCs" (a GCP project is a full
# IAM/billing/quota boundary). This is what "three independently deployable,
# isolated environments" (Phase 1 acceptance criteria) means at the
# infrastructure layer here. Nothing in this file is applied until Mike
# approves the accompanying GCP proposal and the project below exists.

terraform {
  required_version = ">= 1.7"

  # Terraform state lives in Google Cloud Storage (GCS natively supports
  # locking — no separate DynamoDB-equivalent table needed, unlike AWS).
  # This exact bucket name is what Mike is asked to create by hand before the
  # first `terraform init` — see the GCP setup steps in the project.
  backend "gcs" {
    bucket = "beeside-terraform-state-dev-508220"
    prefix = "dev"
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
  description = "The GCP project for the dev environment."
  type        = string
  default     = "beeside-dev-508220" # confirmed by Mike
}

variable "region" {
  description = "Confirmed by Mike: northamerica-south1 (Querétaro, Mexico)."
  type        = string
  default     = "northamerica-south1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enables every Google Cloud API this environment needs. Mike does not need
# to click through the console enabling these one by one — Terraform does it
# on first apply, once the project itself and billing exist.
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
  environment = "dev"
  region      = var.region
  subnet_cidr = "10.10.0.0/20"
  depends_on  = [google_project_service.apis]
}

module "artifact_registry" {
  source      = "../../modules/artifact-registry"
  environment = "dev"
  region      = var.region
  depends_on  = [google_project_service.apis]
}

module "secrets" {
  source      = "../../modules/secrets"
  environment = "dev"
  depends_on  = [google_project_service.apis]
}

module "database" {
  source                 = "../../modules/database"
  environment             = "dev"
  region                  = var.region
  tier                    = "db-g1-small" # smallest practical tier — dev only
  availability_type       = "ZONAL"
  backup_retention_days   = 7
  deletion_protection     = false # relaxed only in dev, to allow teardown/rebuild during early phases
  depends_on              = [google_project_service.apis]
}

module "backend_service" {
  source                             = "../../modules/cloud-run"
  environment                        = "dev"
  region                             = var.region
  service_name                       = "backend-api"
  cloudsql_instance_connection_name  = module.database.instance_connection_name
  allow_unauthenticated              = true # the /health endpoint is meant to be publicly reachable
}

module "frontend_service" {
  source                 = "../../modules/cloud-run"
  environment            = "dev"
  region                 = var.region
  service_name           = "frontend-app"
  allow_unauthenticated  = true
}

# --- CI/CD identity (GitHub Actions -> GCP), no long-lived key ---
# Workload Identity Federation lets GitHub Actions authenticate as this
# environment's deploy service account using a short-lived, per-run token —
# nothing resembling an AWS access key is ever stored in GitHub.
resource "google_service_account" "ci_deployer" {
  account_id   = "beeside-dev-ci-deployer"
  display_name = "beeside dev — GitHub Actions deploy identity"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "beeside-dev-github-pool"
  display_name              = "GitHub Actions (dev)"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id         = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Restricted to Mike's confirmed repository — no other GitHub repo can ever
  # assume this identity.
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
