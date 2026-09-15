-- Operations & Lifecycle Control (Build Plan v1.1 Phases 10–11) — custom SQL (drizzle-kit generate --custom).
-- Integrity rules the Drizzle schema DSL cannot express:
--   * temporary data retention is always defined: from the lifecycle origin until a private link is
--     emitted, then from the access-window start; it only moves later (the fix for completed or
--     never-linked free First Assessments that could otherwise be retained indefinitely);
--   * access, private-link validity and retention stay separate (the access window is untouched);
--   * the transactional email outbox and job runs follow forward-only state machines;
--   * Admin/Supervisor audit is append-only; admin identities bind to one issuer+subject; technical
--     identities can never sign in; the last active login-enabled ADMIN cannot be removed;
--   * the temporary-retention purge is the ONLY path allowed to delete a free project's client data:
--     IN_PROGRESS/COMPLETED_LOCKED → EXPIRED → (purge) → DELETED in one transaction, re-checked under
--     the project row lock so a Premium activation always wins;
--   * legal acceptance records the pinned configuration version that supplied the documents shown.

-- =========================================================================
-- Purge authorization (transaction-local, set only inside fa_purge_temporary_project)
-- =========================================================================
CREATE FUNCTION retention_purge_authorized(p_project_id UUID) RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_project_id IS NOT NULL
     AND current_setting('app.retention_purge_project', true) IS NOT DISTINCT FROM p_project_id::text;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND retention_purge_authorized((to_jsonb(OLD) ->> 'project_id')::uuid) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Row in % is immutable (id=%)', TG_TABLE_NAME, OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_update_delete() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND retention_purge_authorized((to_jsonb(OLD) ->> 'project_id')::uuid) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Row in % is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION answer_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION outbox_event_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION project_access_token_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION premium_activation_request_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF retention_purge_authorized(OLD.project_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'premium_activation_request rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM project WHERE project_id = NEW.project_id AND assessment_state = 'COMPLETED_LOCKED') THEN
      RAISE EXCEPTION 'Premium can be requested only after the First Assessment is complete (project %)', NEW.project_id USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.project_id <> OLD.project_id OR NEW.person_id <> OLD.person_id OR NEW.kind <> OLD.kind
     OR NEW.terms_url <> OLD.terms_url OR NEW.terms_accepted_at <> OLD.terms_accepted_at OR NEW.requested_at <> OLD.requested_at
     OR NEW.checkout_adapter <> OLD.checkout_adapter OR NEW.interface_language <> OLD.interface_language
     OR (OLD.checkout_reference IS NOT NULL AND NEW.checkout_reference IS DISTINCT FROM OLD.checkout_reference) THEN
    RAISE EXCEPTION 'premium_activation_request % is immutable except its checkout reference and fulfilment', OLD.request_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'FULFILLED' AND (NEW.status <> 'FULFILLED' OR NEW.fulfilled_at IS DISTINCT FROM OLD.fulfilled_at OR NEW.fulfilled_by_event_id IS DISTINCT FROM OLD.fulfilled_by_event_id) THEN
    RAISE EXCEPTION 'premium_activation_request % is already fulfilled', OLD.request_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- fa_project_lifecycle: retention always defined, re-anchored once at link emission, never earlier
-- =========================================================================
-- Existing rows: never-linked projects get the deterministic origin-based fallback (v1 policy: 60 days).
UPDATE fa_project_lifecycle
   SET retention_basis = CASE WHEN access_window_started_at IS NULL THEN 'LIFECYCLE_ORIGIN' ELSE 'ACCESS_WINDOW' END,
       retention_until = COALESCE(retention_until, identity_completed_at + interval '60 days');

-- Defensive default for direct inserts; the application always supplies policy-derived values.
CREATE FUNCTION fa_project_lifecycle_retention_default() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.retention_basis IS NULL THEN
    NEW.retention_basis := CASE WHEN NEW.access_window_started_at IS NULL THEN 'LIFECYCLE_ORIGIN' ELSE 'ACCESS_WINDOW' END;
  END IF;
  IF NEW.retention_until IS NULL THEN
    NEW.retention_until := COALESCE(NEW.access_window_started_at, NEW.identity_completed_at) + interval '60 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fa_project_lifecycle_retention_default_trigger
  BEFORE INSERT ON fa_project_lifecycle
  FOR EACH ROW EXECUTE FUNCTION fa_project_lifecycle_retention_default();

ALTER TABLE fa_project_lifecycle
  ADD CONSTRAINT fa_project_lifecycle_retention_defined CHECK (retention_until IS NOT NULL AND retention_basis IN ('LIFECYCLE_ORIGIN', 'ACCESS_WINDOW')),
  ADD CONSTRAINT fa_project_lifecycle_retention_basis_matches_window CHECK ((retention_basis = 'ACCESS_WINDOW') = (access_window_started_at IS NOT NULL)),
  ADD CONSTRAINT fa_project_lifecycle_retention_after_access CHECK (access_max_until IS NULL OR retention_until >= access_max_until),
  ADD CONSTRAINT fa_project_lifecycle_retention_after_origin CHECK (retention_until > identity_completed_at);

CREATE OR REPLACE FUNCTION fa_project_lifecycle_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fa_project_lifecycle rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.identity_completed_at <> OLD.identity_completed_at THEN
    RAISE EXCEPTION 'lifecycle identity of project % is immutable', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  IF (OLD.access_window_started_at IS NOT NULL AND NEW.access_window_started_at IS DISTINCT FROM OLD.access_window_started_at)
     OR (OLD.access_max_until IS NOT NULL AND NEW.access_max_until IS DISTINCT FROM OLD.access_max_until)
     OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
     OR (OLD.reminder_day10_sent_at IS NOT NULL AND NEW.reminder_day10_sent_at IS DISTINCT FROM OLD.reminder_day10_sent_at)
     OR (OLD.recovery_email_sent_at IS NOT NULL AND NEW.recovery_email_sent_at IS DISTINCT FROM OLD.recovery_email_sent_at) THEN
    RAISE EXCEPTION 'lifecycle milestones of project % are write-once', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.access_expires_at IS NOT NULL AND NEW.access_expires_at < OLD.access_expires_at THEN
    RAISE EXCEPTION 'access window of project % can only be extended, never shortened', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  -- Retention: fixed once anchored to the access window; the origin-based fallback may be
  -- re-anchored exactly once, when the first private link is emitted, and never to an earlier date.
  IF NEW.retention_until IS DISTINCT FROM OLD.retention_until OR NEW.retention_basis IS DISTINCT FROM OLD.retention_basis THEN
    IF NOT (OLD.retention_basis = 'LIFECYCLE_ORIGIN' AND NEW.retention_basis = 'ACCESS_WINDOW' AND NEW.retention_until >= OLD.retention_until) THEN
      RAISE EXCEPTION 'retention of project % can only be re-anchored once, to the access window, and never shortened', OLD.project_id
        USING ERRCODE = 'BV409';
    END IF;
  END IF;
  IF OLD.access_expiry_recorded_for IS NOT NULL AND (NEW.access_expiry_recorded_for IS NULL OR NEW.access_expiry_recorded_for < OLD.access_expiry_recorded_for) THEN
    RAISE EXCEPTION 'recorded access expiry of project % only moves forward', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- legal_acceptance: evidence of the configuration version that supplied the documents shown
-- =========================================================================
ALTER TABLE legal_acceptance DISABLE TRIGGER legal_acceptance_append_only;
UPDATE legal_acceptance la SET question_bank_version = p.question_bank_version
  FROM project p WHERE p.project_id = la.project_id AND la.question_bank_version IS NULL;
ALTER TABLE legal_acceptance ENABLE TRIGGER legal_acceptance_append_only;

CREATE FUNCTION legal_acceptance_evidence_default() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.question_bank_version IS NULL THEN
    SELECT question_bank_version INTO NEW.question_bank_version FROM project WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_acceptance_evidence_default_trigger
  BEFORE INSERT ON legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION legal_acceptance_evidence_default();

ALTER TABLE legal_acceptance ADD CONSTRAINT legal_acceptance_config_version_recorded CHECK (question_bank_version IS NOT NULL);

-- =========================================================================
-- admin_user: provisioned sign-in only, one bound identity, technical identities never sign in
-- =========================================================================
ALTER TABLE admin_user
  ADD CONSTRAINT admin_user_technical_identity_no_login CHECK (NOT (login_enabled AND auth_identity LIKE '%@beeside.internal')),
  ADD CONSTRAINT admin_user_login_identity_is_email CHECK (NOT login_enabled OR (auth_identity = lower(btrim(auth_identity)) AND auth_identity ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ADD CONSTRAINT admin_user_auth_binding_pair CHECK ((auth_issuer IS NULL) = (auth_subject IS NULL));

CREATE FUNCTION admin_user_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_user rows are never deleted (deactivate instead)' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.admin_user_id <> OLD.admin_user_id OR NEW.auth_identity <> OLD.auth_identity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'admin_user % identity is immutable', OLD.admin_user_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.auth_subject IS NOT NULL AND (NEW.auth_issuer IS DISTINCT FROM OLD.auth_issuer OR NEW.auth_subject IS DISTINCT FROM OLD.auth_subject) THEN
    RAISE EXCEPTION 'admin_user % is already bound to its identity-provider subject', OLD.admin_user_id USING ERRCODE = 'BV409';
  END IF;
  -- Never leave the Control Center without an active, login-enabled ADMIN once one exists.
  IF OLD.role = 'ADMIN' AND OLD.active AND OLD.login_enabled
     AND NOT (NEW.role = 'ADMIN' AND NEW.active AND NEW.login_enabled)
     AND NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id <> OLD.admin_user_id AND role = 'ADMIN' AND active AND login_enabled) THEN
    RAISE EXCEPTION 'the last active login-enabled ADMIN cannot be deactivated, demoted or disabled' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_user_guard_trigger
  BEFORE UPDATE OR DELETE ON admin_user
  FOR EACH ROW EXECUTE FUNCTION admin_user_guard();

-- =========================================================================
-- admin_session: immutable except activity and one-way revocation
-- =========================================================================
CREATE FUNCTION admin_session_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin sessions are never deleted (revoke instead)' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = NEW.admin_user_id AND active AND login_enabled AND role = NEW.role_at_login) THEN
      RAISE EXCEPTION 'an admin session requires an active, login-enabled admin user with that role' USING ERRCODE = 'BV403';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.session_id <> OLD.session_id OR NEW.admin_user_id <> OLD.admin_user_id OR NEW.token_hash <> OLD.token_hash
     OR NEW.role_at_login <> OLD.role_at_login OR NEW.auth_issuer <> OLD.auth_issuer
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'admin session % is immutable except activity and revocation', OLD.session_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.last_seen_at <> OLD.last_seen_at) THEN
    RAISE EXCEPTION 'admin session % is revoked', OLD.session_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'admin session activity only moves forward' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_session_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON admin_session
  FOR EACH ROW EXECUTE FUNCTION admin_session_guard();

-- =========================================================================
-- admin_audit_event: append-only, with no exception of any kind
-- =========================================================================
CREATE FUNCTION admin_audit_event_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only: % not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_event_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_event
  FOR EACH ROW EXECUTE FUNCTION admin_audit_event_guard();

-- =========================================================================
-- email_delivery: outbox state machine
--   PENDING → SENDING | CANCELLED
--   SENDING → SENDING (lease takeover) | SENT | FAILED | DEAD | CANCELLED
--   FAILED  → SENDING | PENDING (admin retry) | CANCELLED
--   DEAD    → PENDING (admin retry)
--   SENT, CANCELLED terminal
-- =========================================================================
CREATE FUNCTION email_delivery_guard() RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_delivery_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON email_delivery
  FOR EACH ROW EXECUTE FUNCTION email_delivery_guard();

-- email_event lines written for an outbox delivery belong to the same project.
CREATE FUNCTION email_event_delivery_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.delivery_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM email_delivery WHERE delivery_id = NEW.delivery_id AND project_id IS NOT DISTINCT FROM NEW.project_id) THEN
    RAISE EXCEPTION 'email_event references a delivery of another project' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_event_delivery_guard_trigger
  BEFORE INSERT ON email_event
  FOR EACH ROW EXECUTE FUNCTION email_event_delivery_guard();

-- =========================================================================
-- job_run: RUNNING → SUCCEEDED | FAILED | ABANDONED, then immutable
-- =========================================================================
CREATE FUNCTION job_run_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_run rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RUNNING' OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'a job run always starts RUNNING' USING ERRCODE = 'BV409';
    END IF;
    IF (NEW.trigger = 'admin') <> (NEW.triggered_by_admin_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'an admin-triggered job run records its admin user (and only then)' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'job run % is finished and immutable', OLD.run_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.run_id <> OLD.run_id OR NEW.job_name <> OLD.job_name OR NEW.trigger <> OLD.trigger
     OR NEW.triggered_by_admin_user_id IS DISTINCT FROM OLD.triggered_by_admin_user_id OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'job run % identity is immutable', OLD.run_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status <> 'RUNNING' AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'a finished job run records finished_at' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_run_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON job_run
  FOR EACH ROW EXECUTE FUNCTION job_run_guard();

-- =========================================================================
-- retention_purge_record: append-only evidence (never deleted, even by a purge)
-- =========================================================================
ALTER TABLE retention_purge_record
  ADD CONSTRAINT retention_purge_record_basis CHECK (retention_basis IN ('LIFECYCLE_ORIGIN', 'ACCESS_WINDOW')),
  ADD CONSTRAINT retention_purge_record_rows_object CHECK (jsonb_typeof(deleted_rows) = 'object');

CREATE TRIGGER retention_purge_record_append_only
  BEFORE UPDATE OR DELETE ON retention_purge_record
  FOR EACH ROW EXECUTE FUNCTION admin_audit_event_guard();

-- =========================================================================
-- Temporary retention candidates (replaces Phase 9): every non-terminal free assessment whose
-- retention has elapsed — retention can no longer be NULL — excluding any project that ever entered
-- Premium and any project with a pending Premium request awaiting beeside's confirmation.
-- =========================================================================
CREATE OR REPLACE FUNCTION fa_temporary_retention_candidates(p_now TIMESTAMPTZ) RETURNS TABLE (project_id UUID) AS $$
BEGIN
  RETURN QUERY
    SELECT p.project_id
      FROM project p
      JOIN fa_project_lifecycle l ON l.project_id = p.project_id
     WHERE p.assessment_state IN ('IN_PROGRESS', 'COMPLETED_LOCKED', 'EXPIRED')
       AND NOT p.premium_ever_activated
       AND l.retention_until <= p_now
       AND NOT EXISTS (SELECT 1 FROM premium_activation_request r WHERE r.project_id = p.project_id AND r.status = 'REQUESTED')
     ORDER BY l.retention_until, p.project_id
     FOR UPDATE OF p SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- The purge: EXPIRED (audited transition) → delete client data → anonymize now-orphaned person and
-- company → DELETED tombstone, in the caller's transaction. Journey analytics (technical ids only),
-- state transitions and the lifecycle timestamps survive as anonymous product analytics.
-- =========================================================================
CREATE FUNCTION fa_purge_temporary_project(p_project_id UUID, p_now TIMESTAMPTZ, p_job_run_id UUID) RETURNS JSONB AS $$
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
    'project_responsibility_change', 'premium_activation_request', 'outbox_event'
  ] LOOP
    EXECUTE format('DELETE FROM %I WHERE project_id = $1', v_table) USING p_project_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows || jsonb_build_object(v_table, v_count);
  END LOOP;
  PERFORM set_config('app.retention_purge_project', '', true);

  UPDATE project SET assessment_state = 'DELETED', last_completed_step = NULL, updated_at = p_now WHERE project_id = p_project_id;

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
