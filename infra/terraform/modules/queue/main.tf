# Queue module (GCP) — Pub/Sub, the outbox-relay mechanism (Technical
# Architecture v1.1 FINAL §15) that later carries outbox_event /
# subscription_event rows to their consumers (analytics, SmartSuite worker,
# ClickUp outbound worker — Phase 12). Straight vendor swap from AWS SQS.
#
# Defined here for parity with the frozen Build Plan's Phase 1 module list,
# but nothing publishes to it until Phase 9/12 — the accompanying GCP
# proposal recommends NOT applying (creating) this module live in Phase 1,
# to avoid provisioning a service with no consumer yet.

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

resource "google_pubsub_topic" "outbox_relay_dlq" {
  name = "beeside-${var.environment}-outbox-relay-dlq"

  message_retention_duration = "1209600s" # 14 days
}

resource "google_pubsub_topic" "outbox_relay" {
  name = "beeside-${var.environment}-outbox-relay"

  message_retention_duration = "345600s" # 4 days
}

resource "google_pubsub_subscription" "outbox_relay" {
  name  = "beeside-${var.environment}-outbox-relay-sub"
  topic = google_pubsub_topic.outbox_relay.id

  ack_deadline_seconds = 60

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.outbox_relay_dlq.id
    max_delivery_attempts = 5
  }
}

output "topic_id" {
  value = google_pubsub_topic.outbox_relay.id
}

output "dlq_topic_id" {
  value = google_pubsub_topic.outbox_relay_dlq.id
}
