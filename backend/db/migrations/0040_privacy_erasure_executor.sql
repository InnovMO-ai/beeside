-- Privacy erasure (V1.0 Fase 0), part 2: registry rows, guards and the executor (the tables are 0032). Turns the privacy ledger's terminal `anonymized` state from a bare statement into an executed, audited,
-- policy-gated erasure of a project's personal data. Read this header before changing anything below.
--
--   WHAT IT DOES   privacy_erase_project() deletes the client's content and credentials, anonymises the person/company in place (unless another
--                  live project still uses them), asks external destinations to erase their copy (outbox, ids only), records the run and
--                  only then writes `anonymized` to the ledger. Everything runs in ONE transaction under the project row lock.
--   WHAT IT KEEPS  by design and by registry (privacy_erasure_registry): commercial/accounting records, the audit trail, anonymous analytics
--                  and external-reference ids. Nothing else: a table that is not in the registry fails the inventory test.
--   WHO MAY RUN IT only through this function. The function refuses unless ALL hold: an approved privacy_policy exists, the project is
--                  `blocked` in the ledger since at least policy.min_days_after_block days, and no paid subscription is still running.
--                  There is NO default policy: until a SUPER_ADMIN approves one the executor refuses. The internal retention period is a
--                  legal/business decision that has not been taken; it is an input to the policy, never invented here.
--   HOW THE GUARDS  the append-only/immutable triggers stay in force. Each gets one clause: a DELETE is allowed only when
--                  privacy_erasure_authorized(table,row) — a tx-local project setting AND a registry row that says erase — holds.
--                  The runtime role has no DELETE on the Precision tables, and the function is SECURITY DEFINER, so setting the flag from
--                  the application is not enough to delete anything there.
-- Rollback: DROP the function/tables created here and restore the previous guard bodies (each one is the 0031 body without the first IF).

CREATE FUNCTION privacy_policy_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'approved' OR NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = NEW.approved_by AND active AND role::text = 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'a privacy policy is approved by an elevated (SUPER_ADMIN) admin' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy_policy rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'retired' OR NEW.status <> 'retired'
     OR (NEW.policy_id, NEW.version, NEW.min_days_after_block, NEW.retain_legal_acceptance, NEW.approved_by, NEW.approved_at)
        IS DISTINCT FROM (OLD.policy_id, OLD.version, OLD.min_days_after_block, OLD.retain_legal_acceptance, OLD.approved_by, OLD.approved_at) THEN
    RAISE EXCEPTION 'privacy_policy % can only move approved -> retired; its terms never change (approve a new version)', OLD.policy_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER privacy_policy_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON privacy_policy FOR EACH ROW EXECUTE FUNCTION privacy_policy_guard();
--> statement-breakpoint

CREATE FUNCTION privacy_registry_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'privacy_erasure_registry changes only through a migration' USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason) VALUES
  ('email_event', 'delivery_trace', 'erase', 10, NULL, NULL),
  ('email_delivery', 'delivery_trace', 'erase', 20, NULL, NULL),
  ('integration_delivery', 'delivery_trace', 'erase', 30, NULL, NULL),
  ('outbox_event', 'delivery_trace', 'erase', 40, NULL, NULL),
  ('oh_delivery', 'precision_content', 'erase', 50, NULL, NULL),
  ('crp_confirmation', 'precision_content', 'erase', 60, NULL, NULL),
  ('pack', 'precision_content', 'erase', 70, 'category_assessment_instance_id IN (SELECT instance_id FROM category_assessment WHERE project_id = $1)', NULL),
  ('precision_turn', 'precision_content', 'erase', 80, NULL, NULL),
  ('fact', 'precision_content', 'erase', 90, NULL, NULL),
  ('context_pin', 'precision_content', 'erase', 100, NULL, NULL),
  ('precision_assessment', 'precision_content', 'erase', 110, 'instance_id IN (SELECT id FROM precision_instance WHERE project_id = $1)', NULL),
  ('service_map_snapshot', 'precision_content', 'erase', 120, 'precision_instance_id IN (SELECT id FROM precision_instance WHERE project_id = $1)', NULL),
  ('category_assessment', 'precision_content', 'erase', 130, NULL, NULL),
  ('precision_instance', 'precision_content', 'erase', 140, NULL, NULL),
  ('precision_handoff_package', 'assessment_content', 'erase', 150, NULL, NULL),
  ('snapshot', 'assessment_content', 'erase', 160, NULL, NULL),
  ('internal_assessment', 'assessment_content', 'erase', 170, NULL, NULL),
  ('snapshot_feedback', 'assessment_content', 'erase', 180, NULL, NULL),
  ('answer', 'assessment_content', 'erase', 190, NULL, NULL),
  ('finding', 'assessment_content', 'erase', 200, NULL, NULL),
  ('priority_alignment', 'assessment_content', 'erase', 210, NULL, NULL),
  ('capability_rank', 'assessment_content', 'erase', 220, NULL, NULL),
  ('project_access_token', 'credential', 'erase', 230, NULL, NULL),
  ('precision_access_token', 'credential', 'erase', 240, NULL, NULL),
  ('legal_acceptance', 'legal_evidence', 'erase_if_policy', 250, NULL, 'evidence of the terms accepted; kept or erased by the approved policy (retain_legal_acceptance)'),
  ('person', 'identity', 'anonymize', NULL, NULL, 'anonymised in place unless another live project still belongs to the person'),
  ('company', 'identity', 'anonymize', NULL, NULL, 'anonymised in place unless another live project still belongs to the company'),
  ('project', 'skeleton', 'keep', NULL, NULL, 'identifiers, states and version pins only; no personal data (identity lives in person/company)'),
  ('subscription', 'commercial', 'keep', NULL, NULL, 'commercial record (tax/accounting); ids, dates and statuses only'),
  ('subscription_event', 'commercial', 'keep', NULL, NULL, 'commercial ledger; ids, dates and event types only'),
  ('subscription_state_transition', 'commercial', 'keep', NULL, NULL, 'commercial ledger'),
  ('premium_checkout', 'commercial', 'keep', NULL, NULL, 'payment reconciliation; Stripe ids and amounts only'),
  ('premium_activation_request', 'commercial', 'keep', NULL, NULL, 'premium request record; ids, dates and statuses only'),
  ('billing_alert', 'commercial', 'keep', NULL, NULL, 'payment reconciliation; bounded details, no personal data by contract'),
  ('billing_inbound_event', 'commercial', 'keep', NULL, NULL, 'payment reconciliation; summary holds ids and status words only'),
  ('entitlement', 'commercial', 'keep', NULL, NULL, 'access projection; dates and modes only'),
  ('entitlement_grant', 'commercial', 'keep', NULL, NULL, 'governance record (who approved, why, when); operator reason text must not carry personal data'),
  ('project_privacy_event', 'audit', 'keep', NULL, NULL, 'the privacy ledger itself; coded reasons only'),
  ('admin_audit_event', 'audit', 'keep', NULL, NULL, 'operator audit trail; bounded keys only'),
  ('retention_purge_record', 'audit', 'keep', NULL, NULL, 'evidence of earlier purges'),
  ('assessment_state_transition', 'audit', 'keep', NULL, NULL, 'state history; ids and states only'),
  ('project_responsibility_change', 'audit', 'keep', NULL, NULL, 'responsibility history; ids only (the people are anonymised)'),
  ('fa_access_extension', 'operational', 'keep', NULL, NULL, 'access-window extension; dates and an enumerated reason'),
  ('fa_project_lifecycle', 'operational', 'keep', NULL, NULL, 'lifecycle timestamps; no personal data'),
  ('fa_journey_event', 'analytics', 'keep', NULL, NULL, 'anonymous analytics; closed property contract'),
  ('precision_journey_event', 'analytics', 'keep', NULL, NULL, 'anonymous analytics; closed property contract'),
  ('analytics_project_profile', 'analytics', 'keep', NULL, NULL, 'anonymous analytics; enumerated values only'),
  ('precision_cover_seen', 'operational', 'keep', NULL, NULL, 'first-seen timestamp; no personal data'),
  ('operation_hub_link', 'external_reference', 'keep', NULL, NULL, 'ids of the external record; needed to ask the destination to erase its copy'),
  ('integration_external_ref', 'external_reference', 'keep', NULL, NULL, 'ids of the external record; needed to ask the destination to erase its copy'),
  ('admin_user', 'global', 'global', NULL, NULL, 'operator identities'),
  ('admin_session', 'global', 'global', NULL, NULL, 'operator sessions'),
  ('job_run', 'global', 'global', NULL, NULL, 'job history'),
  ('rate_limit_counter', 'global', 'global', NULL, NULL, 'rate limiting'),
  ('country', 'global', 'global', NULL, NULL, 'reference data'),
  ('capability_taxonomy_category', 'global', 'global', NULL, NULL, 'reference data'),
  ('rules_matrix_category', 'global', 'global', NULL, NULL, 'reference data'),
  ('field_key_registry', 'global', 'global', NULL, NULL, 'reference data'),
  ('question_bank_version', 'global', 'global', NULL, NULL, 'versioned configuration'),
  ('rules_engine_version', 'global', 'global', NULL, NULL, 'versioned configuration'),
  ('snapshot_template_version', 'global', 'global', NULL, NULL, 'versioned configuration'),
  ('project_manifest_version', 'global', 'global', NULL, NULL, 'versioned configuration'),
  ('category_manifest_version', 'global', 'global', NULL, NULL, 'versioned configuration'),
  ('config_version_event', 'global', 'global', NULL, NULL, 'configuration history'),
  ('config_version_review', 'global', 'global', NULL, NULL, 'configuration history'),
  ('precision_config', 'global', 'global', NULL, NULL, 'configuration'),
  ('precision_cover_asset', 'global', 'global', NULL, NULL, 'configuration'),
  ('entitlement_program', 'global', 'global', NULL, NULL, 'commercial programs (not project data)'),
  ('entitlement_program_eligibility', 'global', 'global', NULL, NULL, 'commercial programs (not project data)'),
  ('sponsor', 'global', 'global', NULL, NULL, 'sponsors (organisations, not project data)'),
  ('privacy_policy', 'global', 'global', NULL, NULL, 'privacy governance'),
  ('privacy_erasure_registry', 'global', 'global', NULL, NULL, 'privacy governance'),
  ('privacy_erasure_run', 'global', 'global', NULL, NULL, 'privacy governance evidence (ids and counts only)'),
  ('fa4_project', 'fa4', 'other_mechanism', NULL, NULL, 'FA4 has its own identity universe and fa4_anonymize_project()'),
  ('fa4_access_token', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_continuation_request', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_demand_signal', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_email_delivery', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_legal_acceptance', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_privacy_erasure_log', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_result', 'fa4', 'other_mechanism', NULL, NULL, 'see fa4_anonymize_project()'),
  ('fa4_catalog_version', 'global', 'global', NULL, NULL, 'catalog configuration'),
  ('fa4_catalog_change', 'global', 'global', NULL, NULL, 'catalog configuration'),
  ('fa4_catalog_entity', 'global', 'global', NULL, NULL, 'catalog configuration');
--> statement-breakpoint
CREATE TRIGGER privacy_registry_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON privacy_erasure_registry FOR EACH ROW EXECUTE FUNCTION privacy_registry_guard();
--> statement-breakpoint

CREATE FUNCTION privacy_erasure_run_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'privacy_erasure_run is append-only evidence' USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER privacy_erasure_run_guard_trigger BEFORE UPDATE OR DELETE ON privacy_erasure_run FOR EACH ROW EXECUTE FUNCTION privacy_erasure_run_guard();
--> statement-breakpoint
REVOKE UPDATE ON privacy_policy, privacy_erasure_run FROM beeside_runtime_role;
--> statement-breakpoint

-- =========================================================================
-- Authorisation: table-aware and project-scoped (precedent: app.retention_purge_project, 0012)
-- =========================================================================
CREATE FUNCTION privacy_erasure_project_of(p_table TEXT, p_row JSONB) RETURNS UUID AS $$
  SELECT CASE p_table
    WHEN 'pack' THEN (SELECT ca.project_id FROM category_assessment ca WHERE ca.instance_id = (p_row ->> 'category_assessment_instance_id')::uuid)
    WHEN 'service_map_snapshot' THEN (SELECT pi.project_id FROM precision_instance pi WHERE pi.id = (p_row ->> 'precision_instance_id')::uuid)
    WHEN 'precision_assessment' THEN (SELECT pi.project_id FROM precision_instance pi WHERE pi.id = (p_row ->> 'instance_id')::uuid)
    ELSE (p_row ->> 'project_id')::uuid
  END;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE FUNCTION privacy_erasure_context(p_project UUID) RETURNS BOOLEAN AS $$
BEGIN
  IF p_project IS NULL OR NULLIF(current_setting('app.privacy_erasure_project', true), '') IS DISTINCT FROM p_project::text THEN
    RETURN false;
  END IF;
  -- The flag only counts inside the SECURITY DEFINER executor (current_user = its owner). A session that logged in as the application
  -- role can set the setting, but its current_user stays a member of beeside_runtime_role, so it opens nothing (precedent: fa4.erasure).
  -- (direct membership via pg_auth_members: pg_has_role() answers true for every role when the caller is a superuser)
  IF current_user = 'beeside_runtime_role' OR EXISTS (
       SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
        WHERE r.rolname = 'beeside_runtime_role' AND u.rolname = current_user) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint
CREATE FUNCTION privacy_erasure_authorized(p_table TEXT, p_row JSONB) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM privacy_erasure_registry WHERE table_name = p_table AND action IN ('erase', 'erase_if_policy'))
     AND privacy_erasure_context(privacy_erasure_project_of(p_table, p_row));
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint

-- =========================================================================
-- Guards: one DELETE clause each; everything else is the 0031 body, unchanged
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reject_if_project_locked()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  locked_project_id UUID;
  current_state assessment_state;
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  locked_project_id := COALESCE(NEW.project_id, OLD.project_id);
  SELECT assessment_state INTO current_state FROM project WHERE project_id = locked_project_id;
  IF current_state = 'COMPLETED_LOCKED' THEN
    RAISE EXCEPTION 'project % is COMPLETED_LOCKED; % on % is frozen', locked_project_id, TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.answer_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'answer rows are never deleted';
  END IF;
  -- Only superseded_by may change, and only from NULL to a value.
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'answer row % is already superseded; no further changes allowed', OLD.answer_id;
  END IF;
  IF NEW.project_id <> OLD.project_id
     OR NEW.field_key <> OLD.field_key
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.value_type <> OLD.value_type
     OR NEW.answered_at <> OLD.answered_at
     OR NEW.question_bank_version <> OLD.question_bank_version THEN
    RAISE EXCEPTION 'answer rows are immutable except for setting superseded_by once';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND retention_purge_authorized((to_jsonb(OLD) ->> 'project_id')::uuid) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Row in % is immutable (id=%)', TG_TABLE_NAME, OLD;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_update_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND retention_purge_authorized((to_jsonb(OLD) ->> 'project_id')::uuid) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Row in % is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.snapshot_feedback_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'snapshot_feedback rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'snapshot_feedback % is immutable once submitted', OLD.feedback_id USING ERRCODE = 'BV409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project WHERE project_id = NEW.project_id AND assessment_state = 'COMPLETED_LOCKED') THEN
    RAISE EXCEPTION 'feedback belongs to a completed First Assessment (project %)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM snapshot WHERE project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'feedback is asked after the Snapshot, never before (project %)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.project_access_token_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'access tokens are never deleted (revoke instead)' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.token_id <> OLD.token_id OR NEW.project_id <> OLD.project_id OR NEW.kind <> OLD.kind
     OR NEW.token_hash <> OLD.token_hash OR NEW.email_verified <> OLD.email_verified
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'access token % is immutable except last_used_at and revocation', OLD.token_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'access token % revocation is final', OLD.token_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.email_delivery_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'email_delivery rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.sent_at IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'an email delivery is always enqueued as PENDING' USING ERRCODE = 'BV409';
    END IF;
    IF jsonb_typeof(NEW.context) <> 'object' THEN
      RAISE EXCEPTION 'email_delivery.context must be an object' USING ERRCODE = 'BV422';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.dedupe_key <> OLD.dedupe_key OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.person_id <> OLD.person_id OR NEW.template <> OLD.template OR NEW.template_source <> OLD.template_source
     OR NEW.link_kind IS DISTINCT FROM OLD.link_kind OR NEW.context <> OLD.context OR NEW.enqueued_by <> OLD.enqueued_by
     OR NEW.created_at <> OLD.created_at OR NEW.max_attempts <> OLD.max_attempts THEN
    RAISE EXCEPTION 'email delivery % is immutable except its delivery state', OLD.delivery_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status IN ('SENT', 'CANCELLED') THEN
    RAISE EXCEPTION 'email delivery % is final (%)', OLD.delivery_id, OLD.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('SENDING', 'CANCELLED'))
    OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'FAILED', 'DEAD', 'CANCELLED'))
    OR (OLD.status = 'FAILED' AND NEW.status IN ('SENDING', 'PENDING', 'CANCELLED'))
    OR (OLD.status = 'DEAD' AND NEW.status = 'PENDING')) THEN
    RAISE EXCEPTION 'email delivery % cannot move from % to %', OLD.delivery_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'PENDING' AND OLD.status IN ('FAILED', 'DEAD') THEN
    IF NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'a retried email delivery restarts its attempt count' USING ERRCODE = 'BV409';
    END IF;
  ELSIF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'email delivery attempts only increase' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'SENDING' AND (NEW.lease_until IS NULL OR NEW.attempts <> OLD.attempts + 1) THEN
    RAISE EXCEPTION 'claiming an email delivery takes a lease and counts one attempt' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'SENT' AND (NEW.sent_at IS NULL OR NEW.finished_at IS NULL) THEN
    RAISE EXCEPTION 'a sent email delivery records sent_at and finished_at' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IN ('DEAD', 'CANCELLED') AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'a closed email delivery records finished_at' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'CANCELLED' AND COALESCE(NEW.cancel_reason, '') = '' THEN
    RAISE EXCEPTION 'a cancelled email delivery records its reason' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.integration_delivery_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'integration_delivery rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.attempts <> 0 OR NEW.delivered_at IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'an integration delivery is always created as PENDING' USING ERRCODE = 'BV409';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM outbox_event WHERE outbox_event_id = NEW.outbox_event_id
                     AND event_id = NEW.event_id AND event_type = NEW.event_type
                     AND project_id IS NOT DISTINCT FROM NEW.project_id) THEN
      RAISE EXCEPTION 'integration_delivery must mirror its outbox event exactly' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.outbox_event_id <> OLD.outbox_event_id OR NEW.event_id <> OLD.event_id
     OR NEW.destination <> OLD.destination OR NEW.event_type <> OLD.event_type
     OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.created_at <> OLD.created_at OR NEW.max_attempts <> OLD.max_attempts THEN
    RAISE EXCEPTION 'integration delivery % is immutable except its delivery state', OLD.delivery_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status IN ('DELIVERED', 'SKIPPED') THEN
    RAISE EXCEPTION 'integration delivery % is final (%)', OLD.delivery_id, OLD.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status = 'SENDING')
    OR (OLD.status = 'SENDING' AND NEW.status IN ('DELIVERED', 'SKIPPED', 'FAILED', 'DEAD'))
    OR (OLD.status = 'FAILED' AND NEW.status IN ('SENDING', 'PENDING'))
    OR (OLD.status = 'DEAD' AND NEW.status = 'PENDING')) THEN
    RAISE EXCEPTION 'integration delivery % cannot move from % to %', OLD.delivery_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'PENDING' AND OLD.status IN ('FAILED', 'DEAD') THEN
    IF NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'a retried integration delivery restarts its attempt count' USING ERRCODE = 'BV409';
    END IF;
  ELSIF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'integration delivery attempts only increase' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'SENDING' AND (NEW.lease_until IS NULL OR NEW.attempts <> OLD.attempts + 1) THEN
    RAISE EXCEPTION 'claiming an integration delivery takes a lease and counts one attempt' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'DELIVERED' AND (NEW.delivered_at IS NULL OR NEW.finished_at IS NULL OR NEW.adapter_name IS NULL) THEN
    RAISE EXCEPTION 'a delivered integration delivery records its adapter and timestamps' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'SKIPPED' AND (NEW.finished_at IS NULL OR COALESCE(NEW.skip_reason, '') = '') THEN
    RAISE EXCEPTION 'a skipped integration delivery records its reason' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'DEAD' AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'a dead-lettered integration delivery records finished_at' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.outbox_event_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'outbox_event rows are never deleted';
  END IF;
  IF OLD.relayed_at IS NOT NULL THEN
    RAISE EXCEPTION 'outbox_event % already relayed; no further changes allowed', OLD.outbox_event_id;
  END IF;
  IF NEW.event_id <> OLD.event_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.event_type <> OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.occurred_at <> OLD.occurred_at THEN
    RAISE EXCEPTION 'outbox_event rows are immutable except for setting relayed_at once';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.precision_access_token_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'precision_access_token rows are never deleted' USING ERRCODE = 'BV409'; END IF;
  IF (NEW.id, NEW.token_hash, NEW.project_id, NEW.kind, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.token_hash, OLD.project_id, OLD.kind, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'precision_access_token % is immutable except consumed_at/revoked_at', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'precision_access_token % is already consumed', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.precision_append_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'BV409';
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fact_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_owning_project_id UUID;
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fact rows are never deleted (fact %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_owning_project_id FROM precision_instance WHERE id = NEW.scope_instance_id;
    IF v_owning_project_id IS NULL OR v_owning_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'fact.project_id must match the owning precision_instance of scope_instance_id % (cross-project scoping violation)', NEW.scope_instance_id USING ERRCODE = 'BV409';
    END IF;
    IF NEW.source_pin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM context_pin WHERE id = NEW.source_pin_id AND project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'fact.source_pin_id must belong to the same project (cross-project scoping violation)' USING ERRCODE = 'BV409';
    END IF;
    IF NEW.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'a fact never starts already superseded' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.scope_instance_id <> OLD.scope_instance_id OR NEW.field_key <> OLD.field_key
     OR NEW.value IS DISTINCT FROM OLD.value OR NEW.value_type <> OLD.value_type OR NEW.answer_state <> OLD.answer_state
     OR NEW.source <> OLD.source OR NEW.provenance_stage <> OLD.provenance_stage
     OR NEW.confidence IS DISTINCT FROM OLD.confidence OR NEW.created_at <> OLD.created_at
     OR NEW.source_pin_id IS DISTINCT FROM OLD.source_pin_id OR NEW.source_item_ref IS DISTINCT FROM OLD.source_item_ref THEN
    RAISE EXCEPTION 'fact % is immutable except for superseded_by, set exactly once', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'fact % is already superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.context_pin_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'context_pin rows are never deleted (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'current' OR NEW.superseded_by_pin_id IS NOT NULL THEN
      RAISE EXCEPTION 'a context_pin always starts current' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'current' OR NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'context_pin % may only move current -> superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF (NEW.id, NEW.project_id, NEW.source_system, NEW.source_project_id, NEW.source_result_id, NEW.catalog_version,
      NEW.contract_version, NEW.crosswalk_version, NEW.context_hash, NEW.read_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.project_id, OLD.source_system, OLD.source_project_id, OLD.source_result_id, OLD.catalog_version,
      OLD.contract_version, OLD.crosswalk_version, OLD.context_hash, OLD.read_at, OLD.created_at) THEN
    RAISE EXCEPTION 'context_pin % is immutable except status/superseded_by_pin_id', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.superseded_by_pin_id = OLD.id THEN
    RAISE EXCEPTION 'context_pin % cannot supersede itself', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.oh_delivery_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_owner UUID;
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'oh_delivery rows are append-only (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.pack_id IS NOT NULL THEN
    SELECT ca.project_id INTO v_owner FROM pack p JOIN category_assessment ca ON ca.instance_id = p.category_assessment_instance_id WHERE p.id = NEW.pack_id;
  ELSE
    SELECT pi.project_id INTO v_owner FROM service_map_snapshot s JOIN precision_instance pi ON pi.id = s.precision_instance_id WHERE s.id = NEW.snapshot_id;
  END IF;
  IF v_owner IS NULL OR v_owner <> NEW.project_id THEN
    RAISE EXCEPTION 'oh_delivery artifact does not belong to project % (cross-project scoping violation)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IN ('delivered', 'failed') AND NOT EXISTS (
    SELECT 1 FROM oh_delivery q WHERE q.idempotency_key = NEW.idempotency_key AND q.status = 'queued' AND q.attempt = NEW.attempt
  ) THEN
    RAISE EXCEPTION 'oh_delivery % row for key % attempt % has no matching queued row', NEW.status, NEW.idempotency_key, NEW.attempt USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.immutable_row_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are never updated or deleted (id %)', TG_TABLE_NAME, OLD.id USING ERRCODE = 'BV409';
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.precision_assessment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'precision_assessment rows are never deleted (instance %)', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'not_started' OR NEW.confirmed_at IS NOT NULL OR NEW.service_map_snapshot_id IS NOT NULL THEN
      RAISE EXCEPTION 'a precision_assessment always starts not_started, unconfirmed, with no snapshot' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id <> OLD.instance_id OR NEW.manifest_version <> OLD.manifest_version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'precision_assessment % identity and pinned manifest_version are immutable', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.split_recommendation IS NOT NULL AND NEW.split_recommendation IS DISTINCT FROM OLD.split_recommendation THEN
    RAISE EXCEPTION 'precision_assessment % split_recommendation is write-once', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NOT precision_assessment_lifecycle_valid(OLD.lifecycle_status, NEW.lifecycle_status) THEN
    RAISE EXCEPTION 'precision_assessment % cannot move from % to %', OLD.instance_id, OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'BV409';
  END IF;
  -- confirmed_at is maintained automatically: set on every transition into 'confirmed', never cleared
  -- by a later reopen (§5 — "no stored paused state"; a reopen does not erase the prior confirmation
  -- event, it is simply superseded by a later one on the *next* transition into 'confirmed').
  IF NEW.lifecycle_status = 'confirmed' AND OLD.lifecycle_status <> 'confirmed' THEN
    -- clock_timestamp(), not now(): this must be the real event time, not the enclosing
    -- transaction's start time, so a reconfirmation inside a long-running transaction (or a test
    -- harness that runs the whole suite in one transaction) still advances.
    NEW.confirmed_at := clock_timestamp();
  ELSIF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'precision_assessment % confirmed_at is maintained only by the confirmation transition itself', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  -- service_map_snapshot_id is the single sanctioned pointer (§11's current_pack_id pattern, mirrored):
  -- writable only by precision_assessment_confirm() below, via the transaction-local authorization flag.
  IF NEW.service_map_snapshot_id IS DISTINCT FROM OLD.service_map_snapshot_id
     AND COALESCE(current_setting('app.psm_confirmation_authorized', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'precision_assessment.service_map_snapshot_id is written only by precision_assessment_confirm()' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.category_assessment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_owning_project_id UUID;
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'category_assessment rows are never deleted (instance %)', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_owning_project_id FROM precision_instance WHERE id = NEW.instance_id AND scope = 'category';
    IF v_owning_project_id IS NULL THEN
      RAISE EXCEPTION 'category_assessment % must point at a precision_instance with scope=category in the same project', NEW.instance_id USING ERRCODE = 'BV409';
    END IF;
    IF v_owning_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'category_assessment % project_id must match its owning precision_instance (cross-project scoping violation)', NEW.instance_id USING ERRCODE = 'BV409';
    END IF;
    IF NEW.current_pack_id IS NOT NULL THEN
      RAISE EXCEPTION 'a category_assessment never starts with a current_pack_id' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id <> OLD.instance_id OR NEW.project_id <> OLD.project_id OR NEW.category_key <> OLD.category_key
     OR NEW.manifest_version <> OLD.manifest_version OR NEW.category_origin <> OLD.category_origin OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'category_assessment % identity, pinned manifest_version and category_origin are immutable', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NOT category_assessment_lifecycle_valid(OLD.lifecycle_status, NEW.lifecycle_status) THEN
    RAISE EXCEPTION 'category_assessment % cannot move from % to %', OLD.instance_id, OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.current_pack_id IS DISTINCT FROM OLD.current_pack_id
     AND COALESCE(current_setting('app.pack_completion_authorized', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'category_assessment.current_pack_id is written only by category_assessment_complete()' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.precision_instance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Privacy erasure (0032): the one authorised DELETE path. Table-aware and project-scoped; see privacy_erasure_authorized().
  IF TG_OP = 'DELETE' THEN
    IF privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'precision_instance rows are never deleted (instance %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.scope <> OLD.scope OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'precision_instance % identity (project_id, scope, created_at) is immutable', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$function$;

--> statement-breakpoint

-- The ledger's terminal `anonymized` is no longer a free statement: it can only be written by the erasure itself.
CREATE OR REPLACE FUNCTION project_privacy_event_guard() RETURNS TRIGGER AS $$
DECLARE
  v_state TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'project_privacy_event is an append-only ledger' USING ERRCODE = 'BV409';
  END IF;
  SELECT state INTO v_state FROM project_privacy_state WHERE project_id = NEW.project_id;
  v_state := COALESCE(v_state, 'open');
  IF v_state = 'anonymized' THEN
    RAISE EXCEPTION 'project % was anonymized; nothing follows' , NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.event = 'anonymized' AND NOT privacy_erasure_context(NEW.project_id) THEN
    RAISE EXCEPTION 'project % is marked anonymized only by privacy_erase_project()', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.event = 'access_blocked' AND v_state <> 'open' THEN
    RAISE EXCEPTION 'project % access is already blocked', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.event = 'access_restored' AND v_state <> 'blocked' THEN
    RAISE EXCEPTION 'project % has no access block to lift', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- =========================================================================
-- The executor
-- =========================================================================
CREATE FUNCTION privacy_erase_project(p_project_id UUID, p_actor TEXT, p_execute BOOLEAN, p_now TIMESTAMPTZ) RETURNS JSONB AS $$
DECLARE
  v_project project%ROWTYPE;
  v_policy privacy_policy%ROWTYPE;
  v_state TEXT;
  v_since TIMESTAMPTZ;
  v_reg RECORD;
  v_count BIGINT;
  v_plan JSONB := '{}'::jsonb;
  v_retained JSONB := '{}'::jsonb;
  v_reason TEXT;
  v_person_anon BOOLEAN := false;
  v_company_anon BOOLEAN := false;
  v_followups JSONB;
BEGIN
  IF coalesce(btrim(p_actor), '') = '' THEN
    RAISE EXCEPTION 'an actor is required for a privacy erasure' USING ERRCODE = 'BV603';
  END IF;
  SELECT * INTO v_project FROM project WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'BV404';
  END IF;
  SELECT * INTO v_policy FROM privacy_policy WHERE status = 'approved';
  SELECT state, since INTO v_state, v_since FROM project_privacy_state WHERE project_id = p_project_id;
  v_state := COALESCE(v_state, 'open');

  -- ---- policy gate: every condition is re-checked here, under the project lock ----
  IF v_state = 'anonymized' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'already_erased');
  ELSIF v_policy.policy_id IS NULL THEN
    v_reason := 'no_approved_policy';
  ELSIF v_state <> 'blocked' THEN
    v_reason := 'not_blocked';
  ELSIF v_since + make_interval(days => v_policy.min_days_after_block) > p_now THEN
    v_reason := 'retention_window_open';
  ELSIF EXISTS (SELECT 1 FROM subscription WHERE project_id = p_project_id AND status IN ('PREMIUM_ACTIVE', 'CANCELLATION_SCHEDULED')) THEN
    v_reason := 'subscription_running';
  END IF;

  -- ---- plan (also the dry run): rows per table, from the registry ----
  FOR v_reg IN SELECT table_name, action, project_predicate FROM privacy_erasure_registry WHERE action IN ('erase', 'erase_if_policy') ORDER BY erase_order LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %s', v_reg.table_name, COALESCE(v_reg.project_predicate, 'project_id = $1')) INTO v_count USING p_project_id;
    IF v_reg.action = 'erase_if_policy' AND COALESCE(v_policy.retain_legal_acceptance, true) THEN
      v_retained := v_retained || jsonb_build_object(v_reg.table_name, v_count);
    ELSE
      v_plan := v_plan || jsonb_build_object(v_reg.table_name, v_count);
    END IF;
  END LOOP;
  v_followups := jsonb_build_object(
    'external_references', (SELECT count(*) FROM integration_external_ref WHERE project_id = p_project_id) + (SELECT count(*) FROM operation_hub_link WHERE project_id = p_project_id));

  IF v_reason IS NOT NULL THEN
    IF p_execute THEN
      INSERT INTO privacy_erasure_run (project_id, policy_id, actor, outcome, refusal_reason) VALUES (p_project_id, v_policy.policy_id, p_actor, 'refused', v_reason);
    END IF;
    RETURN jsonb_build_object('eligible', false, 'reason', v_reason, 'would_delete', v_plan, 'retained_by_policy', v_retained, 'external_followups', v_followups);
  END IF;
  IF NOT p_execute THEN
    RETURN jsonb_build_object('eligible', true, 'policy_version', v_policy.version, 'would_delete', v_plan, 'retained_by_policy', v_retained, 'external_followups', v_followups);
  END IF;

  -- ---- execute ----
  PERFORM set_config('app.privacy_erasure_project', p_project_id::text, true);
  v_plan := '{}'::jsonb;
  FOR v_reg IN SELECT table_name, action, project_predicate FROM privacy_erasure_registry WHERE action IN ('erase', 'erase_if_policy') ORDER BY erase_order LOOP
    IF v_reg.action = 'erase_if_policy' AND v_policy.retain_legal_acceptance THEN
      CONTINUE;
    END IF;
    IF v_reg.table_name = 'pack' THEN
      -- category_assessment.current_pack_id and pack.category_assessment_instance_id point at each other: break the cycle first.
      PERFORM set_config('app.pack_completion_authorized', 'true', true);
      UPDATE category_assessment SET current_pack_id = NULL WHERE project_id = p_project_id AND current_pack_id IS NOT NULL;
      PERFORM set_config('app.pack_completion_authorized', 'false', true);
    END IF;
    EXECUTE format('DELETE FROM %I WHERE %s', v_reg.table_name, COALESCE(v_reg.project_predicate, 'project_id = $1')) USING p_project_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_plan := v_plan || jsonb_build_object(v_reg.table_name, v_count);
  END LOOP;

  -- Destinations are asked to erase their copy (ids only; the external-reference rows survive for that purpose).
  IF (v_followups ->> 'external_references')::int > 0 THEN
    INSERT INTO outbox_event (project_id, event_type, payload, occurred_at)
    VALUES (p_project_id, 'privacy.project_erased', jsonb_build_object('project_id', p_project_id, 'erased_at', p_now), p_now);
  END IF;

  -- People and companies are anonymised only when no other live project still belongs to them.
  IF NOT EXISTS (SELECT 1 FROM project o LEFT JOIN project_privacy_state s ON s.project_id = o.project_id
                  WHERE o.project_id <> p_project_id AND o.assessment_state <> 'DELETED' AND COALESCE(s.state, 'open') <> 'anonymized'
                    AND (o.created_by_person_id IN (v_project.created_by_person_id, v_project.responsible_person_id)
                         OR o.responsible_person_id IN (v_project.created_by_person_id, v_project.responsible_person_id))) THEN
    UPDATE person
       SET first_name = 'Deleted', last_name = 'Deleted', preferred_name = NULL,
           primary_email = 'deleted-' || person_id::text || '@deleted.invalid', updated_at = p_now
     WHERE person_id IN (v_project.created_by_person_id, v_project.responsible_person_id) AND primary_email NOT LIKE 'deleted-%@deleted.invalid';
    v_person_anon := true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project o LEFT JOIN project_privacy_state s ON s.project_id = o.project_id
                  WHERE o.project_id <> p_project_id AND o.assessment_state <> 'DELETED' AND COALESCE(s.state, 'open') <> 'anonymized'
                    AND o.company_id = v_project.company_id) THEN
    UPDATE company
       SET name = 'Deleted company', website = NULL, normalized_domain = NULL, normalized_name = NULL, email_domain = NULL, updated_at = p_now
     WHERE company_id = v_project.company_id;
    v_company_anon := true;
  END IF;

  INSERT INTO project_privacy_event (project_id, event, reason_code, actor)
  SELECT p_project_id, 'anonymized', COALESCE(reason_code, 'erasure_request'), p_actor FROM project_privacy_state WHERE project_id = p_project_id;
  INSERT INTO privacy_erasure_run (project_id, policy_id, actor, outcome, deleted_rows, person_anonymized, company_anonymized, external_followups)
  VALUES (p_project_id, v_policy.policy_id, p_actor, 'completed', v_plan, v_person_anon, v_company_anon, v_followups);
  PERFORM set_config('app.privacy_erasure_project', '', true);

  RETURN jsonb_build_object('eligible', true, 'executed', true, 'policy_version', v_policy.version, 'deleted_rows', v_plan, 'retained_by_policy', v_retained,
                            'person_anonymized', v_person_anon, 'company_anonymized', v_company_anon, 'external_followups', v_followups);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
--> statement-breakpoint
REVOKE ALL ON FUNCTION privacy_erase_project(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION privacy_erase_project(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO beeside_runtime_role;

