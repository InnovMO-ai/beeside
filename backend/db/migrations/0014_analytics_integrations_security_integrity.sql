-- Analytics, Integrations & Security Hardening (Build Plan v1.1 Phases 12–13) — integrity.
--
--   1. snapshot_feedback: accepted only after the Snapshot exists, once per project, never edited.
--   2. analytics_project_profile: enumerated segmentation values only (no personal data, no open
--      text); kept as anonymous analytics even when a free assessment's client data is purged.
--   3. integration_delivery: outbound delivery state machine (idempotent per event × destination),
--      integration_external_ref: external ids only.
--   4. The temporary-retention purge deletes the feedback comment and pending integration
--      deliveries, and emits retention.project_purged so destinations delete their copy too.
--   5. Database privilege separation: a NOLOGIN group role with the exact privileges the running
--      application needs — no DDL, no ownership, no role management, no migration registry — that
--      the runtime login user (created per environment, outside migrations) inherits.

-- =========================================================================
-- 1. snapshot_feedback — after the Snapshot, once, append-only
-- =========================================================================
CREATE FUNCTION snapshot_feedback_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER snapshot_feedback_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON snapshot_feedback
  FOR EACH ROW EXECUTE FUNCTION snapshot_feedback_guard();

-- =========================================================================
-- 2. analytics_project_profile — enumerations only, never deleted
-- =========================================================================
CREATE FUNCTION analytics_project_profile_guard() RETURNS TRIGGER AS $$
DECLARE
  v_value TEXT;
  v_areas JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'analytics_project_profile rows are anonymous analytics and are never deleted' USING ERRCODE = 'BV409';
  END IF;
  FOREACH v_value IN ARRAY NEW.target_markets LOOP
    IF v_value !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'analytics_project_profile.target_markets holds ISO country codes only' USING ERRCODE = 'BV422';
    END IF;
  END LOOP;
  FOREACH v_value IN ARRAY NEW.expected_capabilities || NEW.operation_components LOOP
    IF v_value !~ '^[a-z0-9_]{1,64}$' THEN
      RAISE EXCEPTION 'analytics_project_profile holds enumerated option values only' USING ERRCODE = 'BV422';
    END IF;
  END LOOP;
  IF jsonb_typeof(NEW.signal_areas) <> 'object' THEN
    RAISE EXCEPTION 'analytics_project_profile.signal_areas must be an object' USING ERRCODE = 'BV422';
  END IF;
  FOR v_areas IN SELECT value FROM jsonb_each(NEW.signal_areas) LOOP
    IF jsonb_typeof(v_areas) <> 'array' THEN
      RAISE EXCEPTION 'analytics_project_profile.signal_areas values must be arrays' USING ERRCODE = 'BV422';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_areas) e WHERE e !~ '^[a-z0-9_]{1,64}$') THEN
      RAISE EXCEPTION 'analytics_project_profile.signal_areas holds area identifiers only' USING ERRCODE = 'BV422';
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.project_id <> OLD.project_id OR NEW.question_bank_version <> OLD.question_bank_version THEN
      RAISE EXCEPTION 'analytics_project_profile identity is immutable' USING ERRCODE = 'BV409';
    END IF;
    IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'analytics_project_profile.completed_at is written once' USING ERRCODE = 'BV409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER analytics_project_profile_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON analytics_project_profile
  FOR EACH ROW EXECUTE FUNCTION analytics_project_profile_guard();

-- =========================================================================
-- 3. integration_delivery — outbound delivery state machine
--   PENDING → SENDING
--   SENDING → SENDING (lease takeover) | DELIVERED | SKIPPED | FAILED | DEAD
--   FAILED  → SENDING | PENDING (admin retry)
--   DEAD    → PENDING (admin retry)
--   DELIVERED, SKIPPED terminal
-- =========================================================================
CREATE FUNCTION integration_delivery_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER integration_delivery_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON integration_delivery
  FOR EACH ROW EXECUTE FUNCTION integration_delivery_guard();

-- The cross-reference is an external id: the destination and project it belongs to never change.
CREATE FUNCTION integration_external_ref_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.destination <> OLD.destination OR NEW.project_id <> OLD.project_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'integration_external_ref identity is immutable' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER integration_external_ref_guard_trigger
  BEFORE UPDATE ON integration_external_ref
  FOR EACH ROW EXECUTE FUNCTION integration_external_ref_guard();

-- =========================================================================
-- 4. Purge: the feedback comment and pending integration deliveries go with the client data, and
--    destinations are told to delete their own copy (ids only).
-- =========================================================================
CREATE OR REPLACE FUNCTION fa_purge_temporary_project(p_project_id UUID, p_now TIMESTAMPTZ, p_job_run_id UUID) RETURNS JSONB AS $$
DECLARE
  v_state assessment_state;
  v_premium BOOLEAN;
  v_person UUID;
  v_responsible UUID;
  v_company UUID;
  v_retention TIMESTAMPTZ;
  v_basis TEXT;
  v_rows JSONB := '{}'::jsonb;
  v_count BIGINT;
  v_person_anonymized BOOLEAN := false;
  v_company_anonymized BOOLEAN := false;
  v_table TEXT;
BEGIN
  SELECT assessment_state, premium_ever_activated, created_by_person_id, responsible_person_id, company_id
    INTO v_state, v_premium, v_person, v_responsible, v_company
    FROM project WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'BV404';
  END IF;
  SELECT retention_until, retention_basis INTO v_retention, v_basis FROM fa_project_lifecycle WHERE project_id = p_project_id FOR UPDATE;

  -- Re-checked under the row lock: a Premium activation or a pending request always wins.
  IF v_premium THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'premium_ever_activated');
  ELSIF v_state NOT IN ('IN_PROGRESS', 'COMPLETED_LOCKED', 'EXPIRED') THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'state_' || lower(v_state::text));
  ELSIF v_retention IS NULL OR v_retention > p_now THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'retention_not_reached');
  ELSIF EXISTS (SELECT 1 FROM premium_activation_request WHERE project_id = p_project_id AND status = 'REQUESTED') THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'premium_request_pending');
  END IF;

  IF v_state <> 'EXPIRED' THEN
    UPDATE project SET assessment_state = 'EXPIRED', updated_at = p_now WHERE project_id = p_project_id;
  END IF;

  PERFORM set_config('app.retention_purge_project', p_project_id::text, true);
  FOREACH v_table IN ARRAY ARRAY[
    'finding', 'priority_alignment', 'capability_rank', 'snapshot', 'internal_assessment', 'answer',
    'legal_acceptance', 'fa_access_extension', 'project_access_token', 'email_event', 'email_delivery',
    'project_responsibility_change', 'premium_activation_request', 'snapshot_feedback', 'integration_delivery', 'outbox_event'
  ] LOOP
    EXECUTE format('DELETE FROM %I WHERE project_id = $1', v_table) USING p_project_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows || jsonb_build_object(v_table, v_count);
  END LOOP;
  PERFORM set_config('app.retention_purge_project', '', true);

  UPDATE project SET assessment_state = 'DELETED', last_completed_step = NULL, updated_at = p_now WHERE project_id = p_project_id;

  -- Destinations that hold a copy of this project must delete it too. Ids only; the delivery is
  -- retried and dead-lettered like any other, and integration_external_ref survives the purge so
  -- the external record can still be addressed.
  IF EXISTS (SELECT 1 FROM integration_external_ref WHERE project_id = p_project_id) THEN
    INSERT INTO outbox_event (project_id, event_type, payload, occurred_at)
    VALUES (p_project_id, 'retention.project_purged', jsonb_build_object('project_id', p_project_id, 'purged_at', p_now), p_now);
  END IF;

  -- People and companies are anonymized only when no other live project still belongs to them.
  IF NOT EXISTS (SELECT 1 FROM project WHERE project_id <> p_project_id AND assessment_state <> 'DELETED'
                   AND (created_by_person_id IN (v_person, v_responsible) OR responsible_person_id IN (v_person, v_responsible))) THEN
    UPDATE person
       SET first_name = 'Deleted', last_name = 'Deleted', preferred_name = NULL,
           primary_email = 'deleted-' || person_id::text || '@deleted.invalid', updated_at = p_now
     WHERE person_id IN (v_person, v_responsible) AND primary_email NOT LIKE 'deleted-%@deleted.invalid';
    v_person_anonymized := true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project WHERE project_id <> p_project_id AND assessment_state <> 'DELETED' AND company_id = v_company) THEN
    UPDATE company
       SET name = 'Deleted company', website = NULL, normalized_domain = NULL, normalized_name = NULL, email_domain = NULL, updated_at = p_now
     WHERE company_id = v_company;
    v_company_anonymized := true;
  END IF;

  INSERT INTO retention_purge_record (project_id, job_run_id, purged_at, previous_state, retention_until, retention_basis, purge_scope,
                                      deleted_rows, person_anonymized, company_anonymized)
  VALUES (p_project_id, p_job_run_id, p_now, v_state, v_retention, v_basis, 'delete_client_data_keep_anonymous_analytics',
          v_rows, v_person_anonymized, v_company_anonymized);

  RETURN jsonb_build_object('purged', true, 'previous_state', v_state, 'deleted_rows', v_rows,
                            'person_anonymized', v_person_anonymized, 'company_anonymized', v_company_anonymized);
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- 5. Database privilege separation (migration user ≠ runtime user)
--
-- This migration creates only a NOLOGIN group role carrying exactly the privileges the running
-- application needs. The login user itself (password or IAM) is created per environment outside
-- migrations, with `GRANT beeside_runtime_role TO <login user>`; this migration performs that grant
-- automatically when a role named beeside_runtime already exists. The migration user keeps
-- ownership of every object, so the runtime user can never alter the schema.
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_runtime_role') THEN
    BEGIN
      CREATE ROLE beeside_runtime_role NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'the migration user needs CREATEROLE to create beeside_runtime_role (privilege separation)';
    END;
  END IF;
END $$;
--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO beeside_runtime_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO beeside_runtime_role;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO beeside_runtime_role;--> statement-breakpoint

-- Append-only in the application: the guards refuse an UPDATE, and so now does the grant.
REVOKE UPDATE ON
  admin_audit_event, retention_purge_record, snapshot_feedback, fa_journey_event,
  assessment_state_transition, subscription_state_transition, project_responsibility_change,
  email_event, fa_access_extension, legal_acceptance, config_version_event, config_version_review,
  finding, priority_alignment, capability_rank, snapshot, internal_assessment, precision_handoff_package
  FROM beeside_runtime_role;--> statement-breakpoint

-- DELETE only where the application legitimately deletes: the temporary-retention purge, the
-- external cross-reference after a destination deletes its copy, and rate-limit housekeeping.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM beeside_runtime_role;--> statement-breakpoint
GRANT DELETE ON
  finding, priority_alignment, capability_rank, snapshot, internal_assessment, answer, legal_acceptance,
  fa_access_extension, project_access_token, email_event, email_delivery, project_responsibility_change,
  premium_activation_request, snapshot_feedback, integration_delivery, outbox_event,
  integration_external_ref, rate_limit_counter
  TO beeside_runtime_role;--> statement-breakpoint

DO $$
BEGIN
  -- Future tables created by this migration user are readable/writable by the runtime role without
  -- another privilege migration; DELETE is never granted by default.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO beeside_runtime_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO beeside_runtime_role', current_user);

  -- Readiness reads the migration registry; it may never write it.
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO beeside_runtime_role';
    EXECUTE 'GRANT SELECT ON drizzle.__drizzle_migrations TO beeside_runtime_role';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_runtime') THEN
    EXECUTE 'GRANT beeside_runtime_role TO beeside_runtime';
  END IF;
END $$;
