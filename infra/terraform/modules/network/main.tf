# Network module (GCP) — a dedicated VPC per environment.
#
# Vendor note: this replaces the AWS VPC module from the original scaffold.
# The architecture this implements is unchanged (Technical Architecture v1.1
# FINAL §13 — isolated environments); only the vendor is different. Combined
# with one GCP *project* per environment (see envs/dev, envs/staging,
# envs/production), this gives stronger isolation than the AWS version did:
# a GCP project boundary is a full IAM/billing/quota boundary, not just a
# network boundary.
#
# Cloud SQL in this scaffold (see modules/database) connects to Cloud Run via
# Cloud Run's built-in Cloud SQL integration (a managed proxy sidecar keyed by
# the instance connection name), NOT via this VPC — so no Serverless VPC
# Access connector (a paid, always-on resource) is required for Phase 1. This
# VPC exists for defense-in-depth (firewall rules) and as the on-ramp for any
# future resource that does need private networking.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  description = "dev | staging | production"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: dev, staging, production."
  }
}

variable "region" {
  type = string
}

resource "google_compute_network" "this" {
  name                    = "beeside-${var.environment}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "private" {
  name          = "beeside-${var.environment}-private"
  ip_cidr_range = var.subnet_cidr
  region        = var.region
  network       = google_compute_network.this.id

  # No external IPs are handed out on this subnet by default; Cloud Run
  # services are serverless and do not live "in" this subnet in Phase 1.
  private_ip_google_access = true
}

variable "subnet_cidr" {
  description = "CIDR for this environment's private subnet. Must not overlap the other two environments'."
  type        = string
}

# Default-deny inbound; nothing needs a custom ingress rule yet since Cloud
# Run and Cloud SQL are reached through Google-managed paths, not this VPC,
# in Phase 1.
resource "google_compute_firewall" "deny_all_ingress" {
  name    = "beeside-${var.environment}-deny-all-ingress"
  network = google_compute_network.this.id

  deny {
    protocol = "all"
  }

  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  priority      = 65534
}

output "network_id" {
  value = google_compute_network.this.id
}

output "network_name" {
  value = google_compute_network.this.name
}

output "subnet_id" {
  value = google_compute_subnetwork.private.id
}
