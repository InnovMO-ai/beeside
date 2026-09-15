-- First Assessment Core — custom SQL migration (drizzle-kit generate --custom).
-- Integrity rules the Drizzle schema DSL cannot express:
--   * field_key_registry is a synchronized representation of shared/canonical-fields
--     (field_registry_sync() is the only write path; keys are never deleted, only deactivated);
--   * person.primary_email is stored normalized (trim + lowercase) — the person_id identity signal;
--   * First Assessment answers are written against the project's pinned question bank and are
--     frozen once the assessment is COMPLETED_LOCKED / EXPIRED / DELETED (precision.* keys excepted);
--   * legal acceptances, access extensions and journey events are append-only;
--   * access tokens are immutable except last use and one-way revocation;
--   * lifecycle milestones are write-once and the access window is never shortened.

-- =========================================================================
-- field_key_registry synchronization
-- =========================================================================
CREATE FUNCTION field_key_registry_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'field_key_registry rows are never deleted (field_registry_sync deactivates removed keys)'
      USING ERRCODE = 'BV409';
  END IF;
  IF current_setting('app.field_registry_sync_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'field_key_registry is synchronized from shared/canonical-fields; write it only through field_registry_sync()'
      USING ERRCODE = 'BV403';
  END IF;
  IF NEW.field_key !~ '^(fa|precision)\.[a-z0-9_]+(\.[a-z0-9_]+)*$' THEN
    RAISE EXCEPTION 'invalid field_key % (expected fa.* or precision.*)', NEW.field_key USING ERRCODE = 'BV422';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.field_key <> OLD.field_key THEN
    RAISE EXCEPTION 'field_key is immutable (%)', OLD.field_key USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER field_key_registry_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON field_key_registry
  FOR EACH ROW EXECUTE FUNCTION field_key_registry_guard();

-- p_fields: JSON array of {field_key, data_type, source, module, description} for ONE module.
-- Upserts every key as active and deactivates any active key of that module not in the set.
CREATE FUNCTION field_registry_sync(p_module TEXT, p_fields JSONB) RETURNS JSONB AS $$
DECLARE
  v_prefix TEXT;
  v_entry RECORD;
  v_inserted INT := 0;
  v_updated INT := 0;
  v_deactivated INT := 0;
  v_is_insert BOOLEAN;
BEGIN
  IF p_module = 'first_assessment' THEN
    v_prefix := 'fa.';
  ELSIF p_module = 'precision' THEN
    v_prefix := 'precision.';
  ELSE
    RAISE EXCEPTION 'unknown module %', p_module USING ERRCODE = 'BV422';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RAISE EXCEPTION 'field set must be a non-empty JSON array' USING ERRCODE = 'BV422';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_fields) AS e
    WHERE jsonb_typeof(e) <> 'object'
       OR e ->> 'module' IS DISTINCT FROM p_module
       OR COALESCE(e ->> 'field_key', '') NOT LIKE v_prefix || '%'
       OR COALESCE(e ->> 'data_type', '') = ''
       OR COALESCE(e ->> 'source', '') = ''
  ) THEN
    RAISE EXCEPTION 'every field must belong to module % (prefix %) and declare data_type and source', p_module, v_prefix
      USING ERRCODE = 'BV422';
  END IF;
  IF (SELECT count(DISTINCT e ->> 'field_key') FROM jsonb_array_elements(p_fields) AS e) <> jsonb_array_length(p_fields) THEN
    RAISE EXCEPTION 'duplicate field_key in field set' USING ERRCODE = 'BV422';
  END IF;

  PERFORM set_config('app.field_registry_sync_authorized', 'true', true);

  FOR v_entry IN
    SELECT e ->> 'field_key' AS field_key, e ->> 'data_type' AS data_type, e ->> 'source' AS source,
           e ->> 'description' AS description
    FROM jsonb_array_elements(p_fields) AS e
    ORDER BY e ->> 'field_key' COLLATE "C"
  LOOP
    INSERT INTO field_key_registry AS r (field_key, data_type, source, module, active, description)
    VALUES (v_entry.field_key, v_entry.data_type, v_entry.source, p_module, true, v_entry.description)
    ON CONFLICT (field_key) DO UPDATE
      SET data_type = EXCLUDED.data_type, source = EXCLUDED.source, module = EXCLUDED.module,
          active = true, description = EXCLUDED.description
      WHERE (r.data_type, r.source, r.module, r.active, r.description)
            IS DISTINCT FROM (EXCLUDED.data_type, EXCLUDED.source, EXCLUDED.module, true, EXCLUDED.description)
    RETURNING (xmax = 0) INTO v_is_insert;
    IF FOUND THEN
      IF v_is_insert THEN v_inserted := v_inserted + 1; ELSE v_updated := v_updated + 1; END IF;
    END IF;
  END LOOP;

  UPDATE field_key_registry
     SET active = false
   WHERE module = p_module AND active
     AND field_key NOT IN (SELECT e ->> 'field_key' FROM jsonb_array_elements(p_fields) AS e);
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  PERFORM set_config('app.field_registry_sync_authorized', 'false', true);

  RETURN jsonb_build_object(
    'module', p_module, 'inserted', v_inserted, 'updated', v_updated, 'deactivated', v_deactivated,
    'active', (SELECT count(*) FROM field_key_registry WHERE module = p_module AND active));
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- person: normalized email is the identity signal for person_id reuse
-- =========================================================================
ALTER TABLE person
  ADD CONSTRAINT person_primary_email_normalized CHECK (primary_email = lower(btrim(primary_email)) AND primary_email LIKE '%_@_%');

-- =========================================================================
-- answer: pinned question bank + frozen after the First Assessment closes
-- =========================================================================
CREATE FUNCTION answer_first_assessment_guard() RETURNS TRIGGER AS $$
DECLARE
  v_state assessment_state;
  v_pinned TEXT;
BEGIN
  IF NEW.field_key LIKE 'precision.%' THEN
    RETURN NEW;
  END IF;
  SELECT assessment_state, question_bank_version INTO v_state, v_pinned FROM project WHERE project_id = NEW.project_id;
  IF v_state IN ('COMPLETED_LOCKED', 'EXPIRED', 'DELETED') THEN
    RAISE EXCEPTION 'project % is %; First Assessment answers can no longer change', NEW.project_id, v_state
      USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.question_bank_version IS DISTINCT FROM v_pinned THEN
    RAISE EXCEPTION 'answer question_bank_version % does not match the project''s pinned version %', NEW.question_bank_version, v_pinned
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER answer_first_assessment_guard_trigger
  BEFORE INSERT OR UPDATE ON answer
  FOR EACH ROW EXECUTE FUNCTION answer_first_assessment_guard();

-- =========================================================================
-- Append-only records (reject_update_delete defined in 0001)
-- =========================================================================
CREATE TRIGGER legal_acceptance_append_only
  BEFORE UPDATE OR DELETE ON legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER fa_access_extension_append_only
  BEFORE UPDATE OR DELETE ON fa_access_extension
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER fa_journey_event_append_only
  BEFORE UPDATE OR DELETE ON fa_journey_event
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

ALTER TABLE fa_journey_event
  ADD CONSTRAINT fa_journey_event_properties_object CHECK (jsonb_typeof(properties) = 'object');

-- =========================================================================
-- project_access_token: immutable except last use and one-way revocation
-- =========================================================================
CREATE FUNCTION project_access_token_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER project_access_token_guard_trigger
  BEFORE UPDATE OR DELETE ON project_access_token
  FOR EACH ROW EXECUTE FUNCTION project_access_token_guard();

-- =========================================================================
-- fa_project_lifecycle: write-once milestones, access window never shortened
-- =========================================================================
CREATE FUNCTION fa_project_lifecycle_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fa_project_lifecycle rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.identity_completed_at <> OLD.identity_completed_at THEN
    RAISE EXCEPTION 'lifecycle identity of project % is immutable', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  IF (OLD.access_window_started_at IS NOT NULL AND NEW.access_window_started_at IS DISTINCT FROM OLD.access_window_started_at)
     OR (OLD.access_max_until IS NOT NULL AND NEW.access_max_until IS DISTINCT FROM OLD.access_max_until)
     OR (OLD.retention_until IS NOT NULL AND NEW.retention_until IS DISTINCT FROM OLD.retention_until)
     OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
     OR (OLD.reminder_day10_sent_at IS NOT NULL AND NEW.reminder_day10_sent_at IS DISTINCT FROM OLD.reminder_day10_sent_at)
     OR (OLD.recovery_email_sent_at IS NOT NULL AND NEW.recovery_email_sent_at IS DISTINCT FROM OLD.recovery_email_sent_at) THEN
    RAISE EXCEPTION 'lifecycle milestones of project % are write-once', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.access_expires_at IS NOT NULL AND NEW.access_expires_at < OLD.access_expires_at THEN
    RAISE EXCEPTION 'access window of project % can only be extended, never shortened', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fa_project_lifecycle_guard_trigger
  BEFORE UPDATE OR DELETE ON fa_project_lifecycle
  FOR EACH ROW EXECUTE FUNCTION fa_project_lifecycle_guard();
