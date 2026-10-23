# KL alerting module (GCP Cloud Monitoring): minimal operational alerts for the KL worker and schedules (M1, 2026-10-19).
# KL-owned resources only; nothing here observes or changes another platform. Notifications go to ONE email channel (changeable via var.alert_email).
#
# Covered: (1) a worker execution that FAILED (all attempts), (2) repeated failed task attempts (the retry masks a transient error; a streak is a problem),
# (3) the worker did NOT run for 20 minutes (schedule paused/broken), (4) any Cloud Scheduler error of the KL schedules (tick and daily export).
# NOT covered (documented limit): "no successful daily export in 24 h" — Cloud Monitoring caps absence/alignment windows below 24 h and would alert every
# day just before the next run; the weekly check `scripts/kl/g2/verify-scheduled-export.sh` and alert (4) cover export failures instead.

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

variable "alert_email" {
  description = "Recipient of KL operational alerts."
  type        = string
}

variable "worker_job_name" {
  type = string
}

variable "scheduler_job_prefix" {
  description = "Prefix of the KL Cloud Scheduler job ids (e.g. beeside-dev-kl-)."
  type        = string
}

locals {
  prefix = "KL ${var.environment}"
  job    = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${var.worker_job_name}\""
}

resource "google_monitoring_notification_channel" "email" {
  display_name = "${local.prefix} · alerts (email)"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

resource "google_monitoring_alert_policy" "worker_execution_failed" {
  display_name = "${local.prefix} · kl-worker: execution failed"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "failed executions > 0 (5 min)"
    condition_threshold {
      filter          = "${local.job} AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    mime_type = "text/markdown"
    content   = "An execution of the KL worker job failed after its retry. Check `gcloud run jobs executions list --job ${var.worker_job_name}` and the stderr logs. If it persists, pause the schedule: `D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh pause worker` (docs/knowledge-layer/kl-1.0-code/G2_D9_CLOUD_SCHEDULER.md)."
  }
}

resource "google_monitoring_alert_policy" "worker_attempts_failing" {
  display_name = "${local.prefix} · kl-worker: repeated failed attempts"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "more than 2 failed task attempts in 30 min"
    condition_threshold {
      # Cloud Run labels a failed attempt that will be retried as result="retried"; only the LAST attempt of an execution is "failed" (verified 21-oct-2026
      # with real data: 2 failing executions with max_retries=1 gave retried=2, failed=2). Counting only "failed" never exceeded the threshold.
      filter          = "${local.job} AND metric.type=\"run.googleapis.com/job/completed_task_attempt_count\" AND (metric.labels.result=\"failed\" OR metric.labels.result=\"retried\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"
      aggregations {
        alignment_period     = "1800s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    mime_type = "text/markdown"
    content   = "Failed attempts keep happening even if the job retry hides them (one isolated failure is expected about once in a few hundred runs: 'knowledge layer database unavailable'). A streak suggests the KL database or the Cloud SQL connector. Check the KL instance state and the worker stderr logs."
  }
}

resource "google_monitoring_alert_policy" "worker_not_running" {
  display_name = "${local.prefix} · kl-worker: no executions for 20 min"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "no completed executions (20 min)"
    condition_absent {
      filter   = "${local.job} AND metric.type=\"run.googleapis.com/job/completed_execution_count\""
      duration = "1200s"
      # Absence must be judged on the SUM of all results. Without the reducer each series (result=failed/retried/succeeded) is judged alone, so every isolated
      # failure opened a false "no executions" incident ~20 min later (seen 22-oct-2026 00:09 UTC while the tick was running every 5 minutes).
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    mime_type = "text/markdown"
    content   = "The worker tick (every 5 minutes) has not completed any execution for 20 minutes. The schedule may be paused (check `bash scripts/kl/g2/d9-scheduler.sh verify`), Cloud Scheduler may be failing, or the job may be unable to start."
  }
}

resource "google_monitoring_alert_policy" "scheduler_errors" {
  display_name = "${local.prefix} · Cloud Scheduler: error in a KL schedule"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "scheduler error log (KL jobs)"
    condition_matched_log {
      filter = "resource.type=\"cloud_scheduler_job\" AND severity>=ERROR AND resource.labels.job_id=~\"^${var.scheduler_job_prefix}\""
    }
  }

  alert_strategy {
    notification_rate_limit { period = "3600s" }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    mime_type = "text/markdown"
    content   = "A KL Cloud Scheduler job (worker tick or daily export) logged an error. For the export, run `bash scripts/kl/g2/verify-scheduled-export.sh`; for permissions, check the scheduler service account roles (klExportOnly custom role and run.invoker)."
  }
}

output "notification_channel" {
  value = google_monitoring_notification_channel.email.id
}

output "policies" {
  value = [
    google_monitoring_alert_policy.worker_execution_failed.display_name,
    google_monitoring_alert_policy.worker_attempts_failing.display_name,
    google_monitoring_alert_policy.worker_not_running.display_name,
    google_monitoring_alert_policy.scheduler_errors.display_name,
  ]
}
