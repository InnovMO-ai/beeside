-- Phase 3 — Versioning & Configuration test suite.
-- Lifecycle (Draft → Preview → Publish), RBAC, bundle validation, publication gates (content vs
-- logic/schema diff review), immutability, audit trail, rollback repoint, and per-project pinning.
--
-- Runs inside ONE transaction that always ends in ROLLBACK; any failed assertion aborts psql
-- (ON_ERROR_STOP), which also discards the transaction. Every assertion prints "<ID> PASS".
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_versioning_tests.sql
\set ON_ERROR_STOP on
\set qb_placeholder `cat db/config-bundles/placeholder/question-bank.json`
\set re_placeholder `cat db/config-bundles/placeholder/rules-engine.json`
\set st_placeholder `cat db/config-bundles/placeholder/snapshot-template.json`

BEGIN;

-- Isolation: the suite exercises every registry from an unconfigured state. On a database that
-- already has published configuration (the development bootstrap), the current pointers are
-- cleared inside this transaction only; the final ROLLBACK restores them untouched.
SELECT set_config('app.config_mutation_authorized', 'true', true) \g /dev/null
UPDATE question_bank_version SET is_current = false WHERE is_current \g /dev/null
UPDATE rules_engine_version SET is_current = false WHERE is_current \g /dev/null
UPDATE snapshot_template_version SET is_current = false WHERE is_current \g /dev/null
SELECT set_config('app.config_mutation_authorized', 'false', true) \g /dev/null

SELECT set_config('vt.qb_placeholder', :'qb_placeholder', true),
       set_config('vt.re_placeholder', :'re_placeholder', true),
       set_config('vt.st_placeholder', :'st_placeholder', true) \g /dev/null

\echo '--- SETUP: helpers, actors, test field keys, bundles ---'
CREATE FUNCTION pg_temp.expect_error(
  p_label TEXT, p_sql TEXT, p_sqlstate TEXT, p_message_like TEXT DEFAULT NULL, p_authorized BOOLEAN DEFAULT false
) RETURNS void AS $$
BEGIN
  BEGIN
    IF p_authorized THEN
      PERFORM set_config('app.config_mutation_authorized', 'true', true);
    END IF;
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate AND (p_message_like IS NULL OR SQLERRM ILIKE '%' || p_message_like || '%') THEN
      RAISE NOTICE '% PASS: rejected [%] %', p_label, SQLSTATE, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION '% FAIL: expected [%]%, got [%] %', p_label, p_sqlstate,
      COALESCE(' containing "' || p_message_like || '"', ''), SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION '% FAIL: statement was accepted but must be rejected with [%]', p_label, p_sqlstate;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.assert_that(p_label TEXT, p_ok BOOLEAN, p_detail TEXT) RETURNS void AS $$
BEGIN
  IF p_ok IS TRUE THEN
    RAISE NOTICE '% PASS: %', p_label, p_detail;
  ELSE
    RAISE EXCEPTION '% FAIL: %', p_label, p_detail;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.actor(p_name TEXT) RETURNS UUID AS $$
BEGIN
  RETURN current_setting('vt.actor_' || p_name)::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.bundle(p_name TEXT) RETURNS JSONB AS $$
BEGIN
  RETURN current_setting('vt.' || p_name)::jsonb;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.version_row(p_registry config_registry, p_version TEXT) RETURNS JSONB AS $$
DECLARE v_row JSONB;
BEGIN
  EXECUTE format('SELECT to_jsonb(t) FROM %I AS t WHERE version = $1', config_registry_table(p_registry))
    INTO v_row USING p_version;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.current_version(p_registry config_registry) RETURNS TEXT AS $$
DECLARE v TEXT;
BEGIN
  EXECUTE format('SELECT version FROM %I WHERE is_current', config_registry_table(p_registry)) INTO v;
  RETURN v;
END;
$$ LANGUAGE plpgsql;

-- Full happy path; LOGIC_SCHEMA changes get an explicit diff review, CONTENT a lightweight approval.
CREATE FUNCTION pg_temp.publish_flow(p_registry config_registry, p_version TEXT, p_bundle JSONB) RETURNS void AS $$
DECLARE v_kind config_change_kind;
BEGIN
  PERFORM config_create_draft(p_registry, p_version, p_bundle, pg_temp.actor('admin'));
  v_kind := (config_submit_for_preview(p_registry, p_version, pg_temp.actor('admin')) ->> 'change_kind')::config_change_kind;
  PERFORM config_record_review(p_registry, p_version, pg_temp.actor('reviewer'), 'APPROVED', v_kind = 'LOGIC_SCHEMA', 'suite fixture');
  PERFORM config_publish(p_registry, p_version, pg_temp.actor('admin'));
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.new_project(p_qb TEXT DEFAULT NULL, p_re TEXT DEFAULT NULL, p_st TEXT DEFAULT NULL) RETURNS UUID AS $$
DECLARE v_project UUID;
BEGIN
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id,
                       question_bank_version, rules_engine_version, snapshot_template_version)
  VALUES (current_setting('vt.company')::uuid, current_setting('vt.person')::uuid, current_setting('vt.person')::uuid,
          p_qb, p_re, p_st)
  RETURNING project_id INTO v_project;
  RETURN v_project;
END;
$$ LANGUAGE plpgsql;

-- Starts a project while the snapshot-template registry has no current version (the current
-- pointer, if any, is cleared inside the caller's subtransaction and restored by its rollback).
CREATE FUNCTION pg_temp.start_project_without_current_template() RETURNS void AS $$
BEGIN
  PERFORM set_config('app.config_mutation_authorized', 'true', true);
  UPDATE snapshot_template_version SET is_current = false WHERE is_current;
  PERFORM set_config('app.config_mutation_authorized', 'false', true);
  PERFORM pg_temp.new_project();
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'vt-admin@beeside.internal') RETURNING admin_user_id INTO v_id;
  PERFORM set_config('vt.actor_admin', v_id::text, true);
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'vt-reviewer@beeside.internal') RETURNING admin_user_id INTO v_id;
  PERFORM set_config('vt.actor_reviewer', v_id::text, true);
  INSERT INTO admin_user (role, auth_identity) VALUES ('SUPERVISOR', 'vt-supervisor@beeside.internal') RETURNING admin_user_id INTO v_id;
  PERFORM set_config('vt.actor_supervisor', v_id::text, true);
  INSERT INTO admin_user (role, auth_identity, active) VALUES ('ADMIN', 'vt-inactive@beeside.internal', false) RETURNING admin_user_id INTO v_id;
  PERFORM set_config('vt.actor_inactive', v_id::text, true);

  INSERT INTO company (name) VALUES ('Versioning Suite Co') RETURNING company_id INTO v_id;
  PERFORM set_config('vt.company', v_id::text, true);
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'Person', 'versioning-suite@beeside-test.invalid', 'es', 'es', 'es') RETURNING person_id INTO v_id;
  PERFORM set_config('vt.person', v_id::text, true);

  -- field_key_registry is sync-only (0006); this rolled-back fixture key uses the sync authorization.
  PERFORM set_config('app.field_registry_sync_authorized', 'true', true);
  INSERT INTO field_key_registry (field_key, data_type, source, module) VALUES
    ('fa.__vt_target_country', 'single_select', 'question_bank', 'first_assessment');

  PERFORM set_config('vt.initial_qb', COALESCE(pg_temp.current_version('QUESTION_BANK'), ''), true);

  PERFORM set_config('vt.qb1_draft', '{"schema_version": 1, "locales": ["en", "es"], "questions": []}', true);
  PERFORM set_config('vt.qb1', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Where do you want to expand?"}, "es": {"title": "¿A dónde quieres expandirte?"}},
     "options": [{"value": "MX", "copy": {"en": "Mexico", "es": "México"}},
                 {"value": "US", "copy": {"en": "United States", "es": "Estados Unidos"}}]}]}', true);
  PERFORM set_config('vt.qb2', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Which market are you expanding into?"}, "es": {"title": "¿A qué mercado te estás expandiendo?"}},
     "options": [{"value": "MX", "copy": {"en": "Mexico", "es": "México"}},
                 {"value": "US", "copy": {"en": "United States", "es": "Estados Unidos"}}]}]}', true);
  PERFORM set_config('vt.qb3', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Which market are you expanding into?"}, "es": {"title": "¿A qué mercado te estás expandiendo?"}},
     "options": [{"value": "MX", "copy": {"en": "Mexico", "es": "México"}},
                 {"value": "US", "copy": {"en": "United States", "es": "Estados Unidos"}},
                 {"value": "CA", "copy": {"en": "Canada", "es": "Canadá"}}]}]}', true);
  PERFORM set_config('vt.qb4', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Which market are you expanding into?"}, "es": {"title": "¿A qué mercado te estás expandiendo?"}},
     "options": [{"value": "MX", "copy": {"en": "Mexico", "es": "México"}},
                 {"value": "US", "copy": {"en": "United States", "es": "Estados Unidos"}},
                 {"value": "BR", "copy": {"en": "Brazil", "es": "Brasil"}}]}]}', true);
  PERFORM set_config('vt.bad_locale', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Where do you want to expand?"}}, "options": []}]}', true);
  PERFORM set_config('vt.bad_variable', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_target_country", "type": "single_select",
     "copy": {"en": {"title": "Hi {{preferred_name}}, where?"}, "es": {"title": "Hola {{preferred_name}}, ¿a dónde?"}}, "options": []}]}', true);
  PERFORM set_config('vt.bad_field_key', '{"schema_version": 1, "locales": ["en", "es"], "questions": [
    {"id": "C1", "field_key": "fa.__vt_not_registered", "type": "single_select",
     "copy": {"en": {"title": "Where?"}, "es": {"title": "¿Dónde?"}}, "options": []}]}', true);
  PERFORM set_config('vt.bad_schema_version', '{"schema_version": "1", "locales": ["en", "es"], "questions": []}', true);
  PERFORM set_config('vt.re1', '{"schema_version": 1, "locales": ["en", "es"], "copy": {"en": {"label": "Rules v1"}, "es": {"label": "Reglas v1"}}}', true);
  PERFORM set_config('vt.re2', '{"schema_version": 1, "locales": ["en", "es"], "copy": {"en": {"label": "Rules, revised label"}, "es": {"label": "Reglas, etiqueta revisada"}}}', true);
  PERFORM set_config('vt.st1', '{"schema_version": 1, "locales": ["en", "es"], "variables": ["preferred_name"], "copy": {"en": {"greeting": "Hi {{preferred_name}}"}, "es": {"greeting": "Hola {{preferred_name}}"}}}', true);
  PERFORM set_config('vt.st2', '{"schema_version": 1, "locales": ["en", "es"], "variables": ["preferred_name"], "copy": {"en": {"greeting": "Hello {{preferred_name}}"}, "es": {"greeting": "Hola de nuevo {{preferred_name}}"}}}', true);
  RAISE NOTICE 'SETUP OK';
END $$;

\ir versioning/10_lifecycle_gates.sql
\ir versioning/20_audit_rollback.sql
\ir versioning/30_pinning.sql

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
