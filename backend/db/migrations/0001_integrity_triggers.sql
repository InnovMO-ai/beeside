-- Custom SQL migration file, put your code below! ---- Deferrable FK for answer.superseded_by (drizzle-orm's schema DSL cannot express
-- DEFERRABLE / INITIALLY DEFERRED foreign keys — see db/schema/assessment.ts).
ALTER TABLE answer
  ADD CONSTRAINT answer_superseded_by_answer_answer_id_fk
  FOREIGN KEY (superseded_by) REFERENCES answer (answer_id)
  DEFERRABLE INITIALLY DEFERRED;

-- Phase 2 — custom SQL migration (drizzle-kit generate --custom)
-- Every integrity rule that Drizzle's schema DSL cannot express declaratively:
-- immutability, append-only, monotonic write-once fields, and freeze-on-lock.

-- =========================================================================
-- Generic: full immutability (blocks UPDATE and DELETE unconditionally)
-- Used by: snapshot, internal_assessment, precision_handoff_package
-- =========================================================================
CREATE FUNCTION reject_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Row in % is immutable (id=%)', TG_TABLE_NAME, OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER snapshot_immutable
  BEFORE UPDATE OR DELETE ON snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER internal_assessment_immutable
  BEFORE UPDATE OR DELETE ON internal_assessment
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER precision_handoff_package_immutable
  BEFORE UPDATE OR DELETE ON precision_handoff_package
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- =========================================================================
-- Generic: append-only (blocks UPDATE and DELETE, INSERT always allowed)
-- Used by: assessment_state_transition, subscription_state_transition,
--          subscription_event, project_responsibility_change
-- =========================================================================
CREATE FUNCTION reject_update_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Row in % is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assessment_state_transition_append_only
  BEFORE UPDATE OR DELETE ON assessment_state_transition
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER subscription_state_transition_append_only
  BEFORE UPDATE OR DELETE ON subscription_state_transition
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER subscription_event_append_only
  BEFORE UPDATE OR DELETE ON subscription_event
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER project_responsibility_change_append_only
  BEFORE UPDATE OR DELETE ON project_responsibility_change
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- =========================================================================
-- answer: append-only log, with exactly one allowed transition —
-- superseded_by going from NULL to a value, once. Everything else is blocked.
-- =========================================================================
CREATE FUNCTION answer_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER answer_append_only
  BEFORE UPDATE OR DELETE ON answer
  FOR EACH ROW EXECUTE FUNCTION answer_guard();

-- =========================================================================
-- outbox_event: everything is immutable except relayed_at, which may be set
-- exactly once (NULL -> a timestamp).
-- =========================================================================
CREATE FUNCTION outbox_event_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER outbox_event_guard_trigger
  BEFORE UPDATE OR DELETE ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION outbox_event_guard();

-- =========================================================================
-- project: three write-once/immutable rules on one row that otherwise
-- changes often (assessment_state, last_completed_step, trust_state, etc.)
--   1. question_bank_version / rules_engine_version / snapshot_template_version
--      are pinned at creation and never change (Technical Architecture v1 §5).
--   2. premium_ever_activated is monotonic: false -> true only, never back.
--   3. precision_state is monotonic: NOT_STARTED -> STARTED only, never back.
-- =========================================================================
CREATE FUNCTION project_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.question_bank_version <> OLD.question_bank_version
     OR NEW.rules_engine_version <> OLD.rules_engine_version
     OR NEW.snapshot_template_version <> OLD.snapshot_template_version THEN
    RAISE EXCEPTION 'project.% pinned version fields are immutable after creation', OLD.project_id;
  END IF;
  IF OLD.premium_ever_activated = true AND NEW.premium_ever_activated = false THEN
    RAISE EXCEPTION 'project.premium_ever_activated cannot revert to false once true';
  END IF;
  IF OLD.precision_state = 'STARTED' AND NEW.precision_state = 'NOT_STARTED' THEN
    RAISE EXCEPTION 'project.precision_state cannot revert to NOT_STARTED once STARTED';
  END IF;
  -- responsible_person_id may only change through reassign_project_responsibility(),
  -- never via a direct UPDATE — otherwise the actor who made the change would be
  -- unrecorded (see project_responsibility_change / reassign_project_responsibility
  -- below). The function sets a one-shot, transaction-local (is_local=true)
  -- authorization flag immediately before its UPDATE; this trigger consumes
  -- (resets) that flag the instant it checks it, so the authorization covers
  -- exactly the one UPDATE the function performs — never any later UPDATE in the
  -- same transaction, and never a concurrent transaction (is_local=true also
  -- keeps it invisible to other sessions).
  IF NEW.responsible_person_id IS DISTINCT FROM OLD.responsible_person_id THEN
    IF current_setting('app.responsibility_change_authorized', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'project.responsible_person_id must only be changed via reassign_project_responsibility(), not a direct UPDATE';
    END IF;
    PERFORM set_config('app.responsibility_change_authorized', 'false', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_guard_trigger
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_guard();

-- =========================================================================
-- reassign_project_responsibility: the ONLY sanctioned way to change
-- project.responsible_person_id. Performs the update and writes a
-- fully-attributed row to project_responsibility_change in the same
-- transaction, identifying the human actor (a client-side person, or a
-- beeside-internal admin_user acting from Precision/Operation Hub) or,
-- for a future automated change, actor_type = 'SYSTEM'.
-- =========================================================================
CREATE FUNCTION reassign_project_responsibility(
  p_project_id UUID,
  p_new_responsible_person_id UUID,
  p_actor_type actor_type,
  p_actor_person_id UUID DEFAULT NULL,
  p_actor_admin_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_previous_responsible_person_id UUID;
  v_change_id UUID;
BEGIN
  -- Defense in depth: project_responsibility_change_actor_consistency (CHECK) enforces
  -- this too, but failing here gives a clearer error before any row is touched.
  IF p_actor_type = 'PERSON' AND (p_actor_person_id IS NULL OR p_actor_admin_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reassign_project_responsibility: actor_type=PERSON requires p_actor_person_id and no p_actor_admin_user_id';
  ELSIF p_actor_type = 'ADMIN_USER' AND (p_actor_admin_user_id IS NULL OR p_actor_person_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reassign_project_responsibility: actor_type=ADMIN_USER requires p_actor_admin_user_id and no p_actor_person_id';
  ELSIF p_actor_type = 'SYSTEM' AND (p_actor_person_id IS NOT NULL OR p_actor_admin_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reassign_project_responsibility: actor_type=SYSTEM must not set p_actor_person_id or p_actor_admin_user_id';
  END IF;

  SELECT responsible_person_id INTO v_previous_responsible_person_id
  FROM project WHERE project_id = p_project_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reassign_project_responsibility: project % not found', p_project_id;
  END IF;

  IF v_previous_responsible_person_id = p_new_responsible_person_id THEN
    RAISE EXCEPTION 'reassign_project_responsibility: project % is already responsible person %', p_project_id, p_new_responsible_person_id;
  END IF;

  -- is_local=true: this authorization is visible only for the rest of the current
  -- transaction, so it cannot leak into any other concurrent or later UPDATE.
  PERFORM set_config('app.responsibility_change_authorized', 'true', true);

  UPDATE project
  SET responsible_person_id = p_new_responsible_person_id,
      updated_at = now()
  WHERE project_id = p_project_id;

  INSERT INTO project_responsibility_change
    (project_id, previous_responsible_person_id, new_responsible_person_id,
     actor_type, actor_person_id, actor_admin_user_id)
  VALUES
    (p_project_id, v_previous_responsible_person_id, p_new_responsible_person_id,
     p_actor_type, p_actor_person_id, p_actor_admin_user_id)
  RETURNING id INTO v_change_id;

  RETURN v_change_id;
END;
$$ LANGUAGE plpgsql;

-- Log every assessment_state change into assessment_state_transition.
CREATE FUNCTION project_log_assessment_state_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assessment_state IS DISTINCT FROM OLD.assessment_state THEN
    INSERT INTO assessment_state_transition (project_id, from_state, to_state, trigger)
    VALUES (NEW.project_id, OLD.assessment_state, NEW.assessment_state, 'project_update');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_log_assessment_state_transition_trigger
  AFTER UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_log_assessment_state_transition();

-- =========================================================================
-- finding / priority_alignment / capability_rank: freeze once the parent
-- project reaches COMPLETED_LOCKED — mutable up to that point, then immutable,
-- per the confirmed Phase 2 decision (no intermediate history needed).
-- =========================================================================
CREATE FUNCTION reject_if_project_locked() RETURNS TRIGGER AS $$
DECLARE
  locked_project_id UUID;
  current_state assessment_state;
BEGIN
  locked_project_id := COALESCE(NEW.project_id, OLD.project_id);
  SELECT assessment_state INTO current_state FROM project WHERE project_id = locked_project_id;
  IF current_state = 'COMPLETED_LOCKED' THEN
    RAISE EXCEPTION 'project % is COMPLETED_LOCKED; % on % is frozen', locked_project_id, TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_freeze_on_lock
  BEFORE UPDATE OR DELETE ON finding
  FOR EACH ROW EXECUTE FUNCTION reject_if_project_locked();

CREATE TRIGGER priority_alignment_freeze_on_lock
  BEFORE UPDATE OR DELETE ON priority_alignment
  FOR EACH ROW EXECUTE FUNCTION reject_if_project_locked();

CREATE TRIGGER capability_rank_freeze_on_lock
  BEFORE UPDATE OR DELETE ON capability_rank
  FOR EACH ROW EXECUTE FUNCTION reject_if_project_locked();

-- =========================================================================
-- finding.evidence_field_keys: every element must be a real field_key_registry key
-- (Postgres cannot express an FK on array elements declaratively).
-- =========================================================================
CREATE FUNCTION finding_validate_evidence_field_keys() RETURNS TRIGGER AS $$
DECLARE
  invalid_keys TEXT[];
BEGIN
  SELECT array_agg(k) INTO invalid_keys
  FROM unnest(NEW.evidence_field_keys) AS k
  WHERE NOT EXISTS (SELECT 1 FROM field_key_registry fkr WHERE fkr.field_key = k);

  IF invalid_keys IS NOT NULL THEN
    RAISE EXCEPTION 'finding.evidence_field_keys contains unknown field_key(s): %', invalid_keys;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_validate_evidence_field_keys_trigger
  BEFORE INSERT OR UPDATE ON finding
  FOR EACH ROW EXECUTE FUNCTION finding_validate_evidence_field_keys();

-- =========================================================================
-- finding.area_id must reference a substantive Rules Matrix area (1-14),
-- never "Other" (category_id 15, is_finding_area = false).
-- =========================================================================
CREATE FUNCTION finding_validate_area_is_finding_area() RETURNS TRIGGER AS $$
DECLARE
  is_valid_area BOOLEAN;
BEGIN
  SELECT is_finding_area INTO is_valid_area FROM rules_matrix_category WHERE category_id = NEW.area_id;
  IF is_valid_area IS NOT TRUE THEN
    RAISE EXCEPTION 'finding.area_id % is not a finding-capable Rules Matrix area', NEW.area_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_validate_area_is_finding_area_trigger
  BEFORE INSERT OR UPDATE ON finding
  FOR EACH ROW EXECUTE FUNCTION finding_validate_area_is_finding_area();

-- =========================================================================
-- subscription: keep `entitlement` and `subscription_state_transition` in sync
-- automatically on every insert/update, instead of trusting each of the four
-- event handlers to remember to do both writes.
-- =========================================================================
CREATE FUNCTION subscription_sync_entitlement_and_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO subscription_state_transition (project_id, subscription_id, from_state, to_state, trigger)
    VALUES (
      NEW.project_id,
      NEW.subscription_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      NEW.status,
      'subscription_write'
    );
  END IF;

  INSERT INTO entitlement (project_id, premium_access_active, effective_from, effective_until, updated_at)
  VALUES (
    NEW.project_id,
    NEW.status = 'PREMIUM_ACTIVE',
    CASE WHEN NEW.status = 'PREMIUM_ACTIVE' THEN now() ELSE NULL END,
    CASE WHEN NEW.status <> 'PREMIUM_ACTIVE' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    premium_access_active = EXCLUDED.premium_access_active,
    effective_from = CASE WHEN EXCLUDED.premium_access_active THEN now() ELSE entitlement.effective_from END,
    effective_until = CASE WHEN NOT EXCLUDED.premium_access_active THEN now() ELSE NULL END,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_sync_entitlement_and_history_trigger
  AFTER INSERT OR UPDATE ON subscription
  FOR EACH ROW EXECUTE FUNCTION subscription_sync_entitlement_and_history();
