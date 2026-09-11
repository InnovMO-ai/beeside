# Secrets module (GCP) — Secret Manager.
#
# Straight vendor swap from AWS Secrets Manager. No application credential is
# ever committed to version control; every consumer (Cloud Run services,
# CI/CD deploy jobs) reads from here at runtime/deploy time via IAM, not by
# checking out a value into a file.

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

locals {
  placeholder_secrets = {
    smartsuite-api-key     = "SmartSuite API credential (outbound sync only, Technical Architecture v1.1 FINAL §9). Value set once Mike provides SmartSuite API credentials."
    email-provider-api-key = "Transactional email provider credential (Phase 5). Value set once Mike provides an account and sending domain."
    sso-client-secret      = "SSO/identity provider credential for the Admin/Supervisor Control Center (Phase 10). Value set once an SSO provider is chosen."
    bot-challenge-secret   = "Bot-challenge provider credential (Phase 13). Value set once Mike provides an account."
  }
}

resource "google_secret_manager_secret" "placeholder" {
  for_each  = local.placeholder_secrets
  secret_id = "beeside-${var.environment}-${each.key}"

  labels = {
    environment = var.environment
    purpose     = "phase-1-placeholder-awaiting-real-value"
  }

  replication {
    auto {}
  }
}

output "secret_ids" {
  value = { for k, v in google_secret_manager_secret.placeholder : k => v.secret_id }
}
