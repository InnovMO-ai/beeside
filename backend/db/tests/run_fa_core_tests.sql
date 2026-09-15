-- First Assessment Core — integrity test suite for migration 0006 (F01–F19).
-- Canonical field registry sync, normalized person email, pinned + frozen answers, append-only
-- records, access-token immutability and the write-once / never-shortened access lifecycle.
--
-- Runs inside ONE transaction that always ends in ROLLBACK; fixtures are addressed by the ids this
-- suite creates, so it is safe on a database that already holds configuration or other data.
-- Every assertion prints "<ID> PASS"; any unexpected error aborts psql (ON_ERROR_STOP).
-- Append-only rows reuse reject_update_delete() from 0001, which raises the generic P0001.
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_fa_core_tests.sql
\set ON_ERROR_STOP on

BEGIN;

\echo '--- SETUP: helpers, test-only published versions, fixtures ---'
CREATE FUNCTION pg_temp.expect_error(p_label TEXT, p_sql TEXT, p_sqlstate TEXT, p_message_like TEXT) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate AND SQLERRM ILIKE '%' || p_message_like || '%' THEN
      RAISE NOTICE '% PASS: rejected [%] %', p_label, SQLSTATE, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION '% FAIL: expected [%] containing "%", got [%] %', p_label, p_sqlstate, p_message_like, SQLSTATE, SQLERRM;
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

CREATE FUNCTION pg_temp.fx(p_name TEXT) RETURNS UUID AS $$
BEGIN
  RETURN current_setting('fa_test.' || p_name)::uuid;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_admin UUID;
  v_registry config_registry;
  v_company UUID;
  v_person UUID;
  v_project UUID;
  v_token UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'fa-core-suite@beeside.internal') RETURNING admin_user_id INTO v_admin;
  FOREACH v_registry IN ARRAY ARRAY['QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE']::config_registry[] LOOP
    PERFORM config_create_draft(v_registry, 'fa-suite-v1',
      CASE WHEN v_registry = 'QUESTION_BANK' THEN '{"schema_version": 1, "locales": ["en", "es"], "questions": [], "suite": "fa-core"}'
           ELSE '{"schema_version": 1, "locales": ["en", "es"], "suite": "fa-core"}' END::jsonb, v_admin);
    PERFORM config_submit_for_preview(v_registry, 'fa-suite-v1', v_admin);
    PERFORM config_record_review(v_registry, 'fa-suite-v1', v_admin, 'APPROVED', true, 'fa core suite fixture');
    PERFORM config_publish(v_registry, 'fa-suite-v1', v_admin);
  END LOOP;

  PERFORM field_registry_sync('first_assessment', '[{"field_key": "fa.suite.probe", "data_type": "text", "source": "question_bank", "module": "first_assessment", "description": "suite"}]');
  PERFORM field_registry_sync('precision', '[{"field_key": "precision.suite.probe", "data_type": "text", "source": "precision", "module": "precision", "description": "suite"}]');

  INSERT INTO company (name) VALUES ('FA Suite Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'Person', 'fa-suite-person@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_project;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_project;
  INSERT INTO legal_acceptance (person_id, project_id, document, document_url, interface_language)
    VALUES (v_person, v_project, 'TERMS', 'https://www.beeside.you/termsandconditions', 'en');
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at, access_window_started_at, access_expires_at, access_max_until, retention_until)
    VALUES (v_project, now(), now(), now(), now() + interval '15 days', now() + interval '45 days', now() + interval '60 days');
  INSERT INTO fa_access_extension (project_id, requested_days, reason, previous_expires_at, new_expires_at, was_expired)
    VALUES (v_project, 15, 'MISSING_INFORMATION', now() + interval '15 days', now() + interval '30 days', false);
  INSERT INTO fa_journey_event (event_type, project_id, step_id) VALUES ('step_viewed', v_project, 'goal');
  INSERT INTO project_access_token (project_id, kind, token_hash, email_verified, expires_at)
    VALUES (v_project, 'RESUME', 'fa-suite-token-hash', true, now() + interval '45 days') RETURNING token_id INTO v_token;

  PERFORM set_config('fa_test.company', v_company::text, true);
  PERFORM set_config('fa_test.person', v_person::text, true);
  PERFORM set_config('fa_test.project', v_project::text, true);
  PERFORM set_config('fa_test.token', v_token::text, true);
  RAISE NOTICE 'SETUP OK: fa-suite-v1 current, probe keys synced, project % IN_PROGRESS', v_project;
END $$;

\echo '--- F01-F04: canonical field registry is synchronized, never hand-written ---'
DO $t$
DECLARE v_result JSONB;
BEGIN
  PERFORM pg_temp.expect_error('F01', $q$INSERT INTO field_key_registry (field_key, data_type, source, module, active) VALUES ('fa.suite.manual', 'text', 'question_bank', 'first_assessment', true)$q$,
    'BV403', 'synchronized from shared/canonical-fields');
  PERFORM pg_temp.expect_error('F02', $q$SELECT field_registry_sync('first_assessment', '[{"field_key": "precision.wrong", "data_type": "text", "source": "x", "module": "first_assessment"}]')$q$,
    'BV422', 'must belong to module');
  PERFORM pg_temp.expect_error('F03', $q$DELETE FROM field_key_registry WHERE field_key = 'fa.suite.probe'$q$, 'BV409', 'never deleted');
  v_result := field_registry_sync('first_assessment', '[{"field_key": "fa.suite.probe", "data_type": "text", "source": "question_bank", "module": "first_assessment", "description": "suite"}]');
  PERFORM pg_temp.assert_that('F04',
    (v_result ->> 'inserted')::int = 0 AND (v_result ->> 'updated')::int = 0
    AND (SELECT active FROM field_key_registry WHERE field_key = 'fa.suite.probe'),
    're-syncing an unchanged field set is a no-op; removed keys are deactivated, not deleted');
END $t$;

\echo '--- F05: person.primary_email is stored normalized ---'
SELECT pg_temp.expect_error('F05', $q$INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language) VALUES ('X', 'Y', ' Mixed@Example.TEST ', 'en', 'en', 'en')$q$,
  '23514', 'person_primary_email_normalized') \g /dev/null

\echo '--- F06-F09: answers use the pinned question bank and freeze when the assessment closes ---'
DO $t$
DECLARE v_project UUID := pg_temp.fx('project');
BEGIN
  PERFORM pg_temp.expect_error('F06', format($q$INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (%L, 'fa.suite.probe', '"x"', 'text', 'fa-not-pinned')$q$, v_project),
    'BV409', 'does not match the project''s pinned version');
  INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (v_project, 'fa.suite.probe', '"before lock"', 'text', 'fa-suite-v1');
  PERFORM pg_temp.assert_that('F07', EXISTS (SELECT 1 FROM answer WHERE project_id = v_project AND field_key = 'fa.suite.probe'),
    'an answer on the pinned question bank version is accepted while IN_PROGRESS');
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v_project;
  PERFORM pg_temp.expect_error('F08', format($q$INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (%L, 'fa.suite.probe', '"after lock"', 'text', 'fa-suite-v1')$q$, v_project),
    'BV409', 'can no longer change');
  INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (v_project, 'precision.suite.probe', '"precision"', 'text', 'fa-suite-v1');
  PERFORM pg_temp.assert_that('F09', EXISTS (SELECT 1 FROM answer WHERE project_id = v_project AND field_key = 'precision.suite.probe'),
    'precision.* answers remain writable after the First Assessment is locked (continuity into Precision)');
END $t$;

\echo '--- F10-F13: legal acceptances, extensions and journey events are append-only ---'
DO $t$
DECLARE v_project UUID := pg_temp.fx('project');
BEGIN
  PERFORM pg_temp.expect_error('F10', format($q$UPDATE legal_acceptance SET document_url = 'https://example.test' WHERE project_id = %L$q$, v_project), 'P0001', 'is append-only');
  PERFORM pg_temp.expect_error('F11', format($q$DELETE FROM fa_access_extension WHERE project_id = %L$q$, v_project), 'P0001', 'is append-only');
  PERFORM pg_temp.expect_error('F12', format($q$UPDATE fa_journey_event SET step_id = 'other' WHERE project_id = %L$q$, v_project), 'P0001', 'is append-only');
  PERFORM pg_temp.expect_error('F13', $q$INSERT INTO fa_journey_event (event_type, properties) VALUES ('step_viewed', '[]')$q$, '23514', 'fa_journey_event_properties_object');
END $t$;

\echo '--- F14-F16: access tokens change only by last use and one-way revocation ---'
DO $t$
DECLARE v_token UUID := pg_temp.fx('token');
BEGIN
  PERFORM pg_temp.expect_error('F14', format($q$UPDATE project_access_token SET expires_at = expires_at + interval '1 day' WHERE token_id = %L$q$, v_token), 'BV409', 'immutable except');
  UPDATE project_access_token SET last_used_at = now(), revoked_at = now() WHERE token_id = v_token;
  PERFORM pg_temp.assert_that('F15', (SELECT last_used_at IS NOT NULL AND revoked_at IS NOT NULL FROM project_access_token WHERE token_id = v_token),
    'recording last use and revoking a token are allowed');
  PERFORM pg_temp.expect_error('F16', format($q$UPDATE project_access_token SET revoked_at = NULL WHERE token_id = %L$q$, v_token), 'BV409', 'revocation is final');
END $t$;

\echo '--- F17-F19: access lifecycle milestones are write-once; access is extended, never shortened ---'
DO $t$
DECLARE v_project UUID := pg_temp.fx('project');
BEGIN
  PERFORM pg_temp.expect_error('F17', format($q$UPDATE fa_project_lifecycle SET access_expires_at = access_expires_at - interval '1 day' WHERE project_id = %L$q$, v_project), 'BV409', 'never shortened');
  PERFORM pg_temp.expect_error('F18', format($q$UPDATE fa_project_lifecycle SET access_max_until = access_max_until + interval '1 day' WHERE project_id = %L$q$, v_project), 'BV409', 'write-once');
  UPDATE fa_project_lifecycle SET access_expires_at = access_expires_at + interval '15 days' WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('F19',
    (SELECT access_expires_at > now() + interval '29 days' FROM fa_project_lifecycle WHERE project_id = v_project),
    'extending the access window is allowed');
END $t$;

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
