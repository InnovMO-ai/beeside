# Observability module (GCP) — minimal Phase 1 baseline.
#
# Vendor note: Cloud Logging and Cloud Monitoring are enabled automatically
# for every GCP project at no extra setup cost and a generous free tier (this
# is a genuine difference from AWS, where CloudWatch log groups/alarms had to
# be created explicitly) — so this module is now deliberately smaller than
# its AWS predecessor. It creates a dedicated log-based metric for backend
# error-rate visibility from day one; a full alerting policy (with a real
# notification channel — email/Slack/PagerDuty) is deferred until there is
# real traffic to alert on (recommended: introduce it alongside Phase 12's
# instrumentation, not before).

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

resource "google_logging_metric" "backend_errors" {
  name   = "beeside-${var.environment}-backend-errors"
  filter = "resource.type=\"cloud_run_revision\" AND severity>=ERROR"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

output "error_metric_name" {
  value = google_logging_metric.backend_errors.name
}
