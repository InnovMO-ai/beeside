# Narrow, tag-scoped exception to beeside.you's organization-level Domain
# Restricted Sharing policy (constraints/iam.allowedPolicyMemberDomains),
# limited to exactly the two Cloud Run services below. The organization's
# policy is never edited; this project-level policy uses
# inherit_from_parent = true so it MERGES with (never replaces) the org's
# existing policy — any resource without the allUsersIngress=true tag is
# governed exactly as it is today. Only backend-api and frontend-app carry
# the tag. Staging and production have no equivalent file and are
# unaffected.
#
# The two roles/run.invoker -> allUsers bindings at the bottom of this file
# used to live inside the shared cloud-run module. They were moved here
# specifically so each one can carry an explicit depends_on this policy and
# its own tag binding — Terraform only orders resources by reference or
# depends_on, and neither existed before, so nothing guaranteed the org
# policy or tags were in place before Terraform attempted the public grant.
# (A depends_on on the module block itself is not an option: the tag
# bindings below already depend on the module's own service_name output, so
# making the module also depend on them would be a cycle.) These bindings
# are unconditional here — this file's entire purpose is granting exactly
# these two dev services public access, so there is no separate flag to
# gate them on.

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_tags_tag_key" "public_ingress" {
  parent      = "projects/${data.google_project.current.number}"
  short_name  = "allUsersIngress"
  description = "Marks exactly which Cloud Run services in this dev project may be publicly invocable via a narrow conditional exception to beeside.you's Domain Restricted Sharing policy."
}

resource "google_tags_tag_value" "true" {
  parent     = google_tags_tag_key.public_ingress.id
  short_name = "true"
}

resource "google_tags_location_tag_binding" "backend_public" {
  parent    = "//run.googleapis.com/projects/${data.google_project.current.number}/locations/${var.region}/services/${module.backend_service.service_name}"
  tag_value = google_tags_tag_value.true.id
  location  = var.region
}

resource "google_tags_location_tag_binding" "frontend_public" {
  parent    = "//run.googleapis.com/projects/${data.google_project.current.number}/locations/${var.region}/services/${module.frontend_service.service_name}"
  tag_value = google_tags_tag_value.true.id
  location  = var.region
}

resource "google_org_policy_policy" "domain_restricted_sharing_dev" {
  name   = "projects/${data.google_project.current.number}/policies/iam.allowedPolicyMemberDomains"
  parent = "projects/${data.google_project.current.number}"

  spec {
    inherit_from_parent = true

    rules {
      # Mandatory unconditional rule (Org Policy requires at least one
      # whenever a conditional rule is present). Adds nothing on top of
      # what inherit_from_parent already merges in from the organization's
      # existing policy.
      values {
        allowed_values = []
      }
    }

    rules {
      # Only resources carrying allUsersIngress=true (bound above to
      # exactly backend-api and frontend-app) get this additional grant.
      condition {
        expression = "resource.matchTag('${data.google_project.current.number}/allUsersIngress', 'true')"
      }
      allow_all = "TRUE"
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  location = var.region
  name     = module.backend_service.service_name
  role     = "roles/run.invoker"
  member   = "allUsers"

  # Waits for backend-api's own tag binding AND the conditional policy —
  # both, since either one alone still leaves the Domain Restricted Sharing
  # default in force for this binding.
  depends_on = [
    google_tags_location_tag_binding.backend_public,
    google_org_policy_policy.domain_restricted_sharing_dev,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  location = var.region
  name     = module.frontend_service.service_name
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [
    google_tags_location_tag_binding.frontend_public,
    google_org_policy_policy.domain_restricted_sharing_dev,
  ]
}
