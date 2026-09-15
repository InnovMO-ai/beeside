-- Operations & Lifecycle Control — integrity suite for migrations 0011/0012 (O01–O30).
-- Retention always defined (origin fallback, one-time re-anchor, never shortened), legal-acceptance
-- evidence, admin identity/session/audit guards, the email outbox and job-run state machines, the
-- retention candidates and the purge (EXPIRED → DELETED tombstone, Premium/pending request win,
-- shared people kept, anonymous analytics kept).
--
-- Runs inside ONE transaction that always ends in ROLLBACK; fixtures are addressed by the ids this
-- suite creates, so it is safe on a database that already holds configuration or other data.
-- Every assertion prints "<ID> PASS"; any unexpected error aborts psql (ON_ERROR_STOP).
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_operations_tests.sql
\set ON_ERROR_STOP on

BEGIN;

\echo '--- SETUP: helpers, test-only published versions, projects ---'
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

CREATE FUNCTION pg_temp.id(p_name TEXT) RETURNS UUID AS $$
BEGIN
  RETURN current_setting('ops_test.' || p_name)::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.new_project(p_name TEXT, p_company UUID, p_person UUID) RETURNS UUID AS $$
DECLARE v_project UUID;
BEGIN
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (p_company, p_person, p_person) RETURNING project_id INTO v_project;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_project;
  PERFORM set_config('ops_test.' || p_name, v_project::text, true);
  RETURN v_project;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_admin UUID;
  v_registry config_registry;
  v_company UUID;
  v_person UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'operations-suite@beeside.internal') RETURNING admin_user_id INTO v_admin;
  PERFORM set_config('ops_test.technical_admin', v_admin::text, true);
  FOREACH v_registry IN ARRAY ARRAY['QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE']::config_registry[] LOOP
    PERFORM config_create_draft(v_registry, 'ops-suite-v1',
      CASE WHEN v_registry = 'QUESTION_BANK' THEN '{"schema_version": 1, "locales": ["en", "es"], "questions": [], "suite": "operations"}'
           ELSE '{"schema_version": 1, "locales": ["en", "es"], "suite": "operations"}' END::jsonb, v_admin);
    PERFORM config_submit_for_preview(v_registry, 'ops-suite-v1', v_admin);
    PERFORM config_record_review(v_registry, 'ops-suite-v1', v_admin, 'APPROVED', true, 'operations suite fixture');
    PERFORM config_publish(v_registry, 'ops-suite-v1', v_admin);
  END LOOP;
  PERFORM set_config('app.field_registry_sync_authorized', 'true', true);
  INSERT INTO field_key_registry (field_key, data_type, source, module) VALUES ('fa.__ops_suite_field', 'text', 'question_bank', 'first_assessment');
  PERFORM set_config('app.field_registry_sync_authorized', 'false', true);

  INSERT INTO company (name) VALUES ('Operations Suite Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'One', 'operations-suite-one@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  PERFORM set_config('ops_test.company1', v_company::text, true);
  PERFORM set_config('ops_test.person1', v_person::text, true);
  PERFORM pg_temp.new_project('project1', v_company, v_person);
  PERFORM pg_temp.new_project('project2', v_company, v_person);
  RAISE NOTICE 'SETUP OK: ops-suite-v1 current';
END $$;

\echo '--- O01-O07: retention is always defined, re-anchored once, never shortened; legal evidence ---'
DO $t$
DECLARE v_life fa_project_lifecycle%ROWTYPE; v_project UUID := pg_temp.id('project1');
BEGIN
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at) VALUES (v_project, now() - interval '20 days', now() - interval '20 days');
  SELECT * INTO v_life FROM fa_project_lifecycle WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('O01', v_life.retention_basis = 'LIFECYCLE_ORIGIN' AND v_life.retention_until = v_life.identity_completed_at + interval '60 days',
    'a lifecycle without any private link gets a deterministic retention date from its origin');

  PERFORM pg_temp.expect_error('O02',
    format($q$INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at, retention_until, retention_basis) VALUES (%L, now(), now(), now() + interval '60 days', 'ACCESS_WINDOW')$q$, pg_temp.id('project2')),
    '23514', 'fa_project_lifecycle_retention_basis_matches_window');

  UPDATE fa_project_lifecycle
     SET access_window_started_at = now() - interval '5 days', access_expires_at = now() + interval '10 days', access_max_until = now() + interval '40 days',
         retention_until = now() + interval '55 days', retention_basis = 'ACCESS_WINDOW'
   WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('O03', (SELECT retention_basis = 'ACCESS_WINDOW' FROM fa_project_lifecycle WHERE project_id = v_project),
    'the first private link re-anchors retention to the access window (later than the origin fallback)');

  PERFORM pg_temp.expect_error('O04', format($q$UPDATE fa_project_lifecycle SET retention_until = retention_until - interval '1 day' WHERE project_id = %L$q$, v_project), 'BV409', 'never shortened');
  PERFORM pg_temp.expect_error('O05', format($q$UPDATE fa_project_lifecycle SET retention_basis = 'LIFECYCLE_ORIGIN' WHERE project_id = %L$q$, v_project), 'BV409', 're-anchored once');

  UPDATE fa_project_lifecycle SET access_expiry_recorded_for = access_expires_at WHERE project_id = v_project;
  PERFORM pg_temp.expect_error('O06', format($q$UPDATE fa_project_lifecycle SET access_expiry_recorded_for = access_expires_at - interval '1 day' WHERE project_id = %L$q$, v_project), 'BV409', 'only moves forward');

  INSERT INTO legal_acceptance (person_id, project_id, document, document_url, interface_language) VALUES (pg_temp.id('person1'), v_project, 'PRIVACY_POLICY', NULL, 'en');
  PERFORM pg_temp.assert_that('O07', (SELECT question_bank_version = 'ops-suite-v1' AND document_url IS NULL FROM legal_acceptance WHERE project_id = v_project AND document = 'PRIVACY_POLICY'),
    'a legal acceptance records the pinned configuration version that supplied the documents (Privacy Policy URL not invented)');
END $t$;

\echo '--- O08-O16: admin identities, sessions and audit ---'
DO $t$
DECLARE v_human UUID; v_session UUID; v_others BOOLEAN;
BEGIN
  PERFORM pg_temp.expect_error('O08', $q$INSERT INTO admin_user (role, auth_identity, login_enabled) VALUES ('ADMIN', 'robot@beeside.internal', true)$q$, '23514', 'admin_user_technical_identity_no_login');
  PERFORM pg_temp.expect_error('O09', $q$INSERT INTO admin_user (role, auth_identity, login_enabled) VALUES ('ADMIN', 'Not An Email', true)$q$, '23514', 'admin_user_login_identity_is_email');

  INSERT INTO admin_user (role, auth_identity, login_enabled, auth_issuer, auth_subject) VALUES ('ADMIN', 'ops.suite.admin@example.test', true, 'https://idp.example', 'subject-1')
    RETURNING admin_user_id INTO v_human;
  PERFORM set_config('ops_test.human_admin', v_human::text, true);
  PERFORM pg_temp.expect_error('O10', format($q$UPDATE admin_user SET auth_subject = 'subject-2' WHERE admin_user_id = %L$q$, v_human), 'BV409', 'already bound');

  SELECT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id <> v_human AND role = 'ADMIN' AND active AND login_enabled) INTO v_others;
  IF v_others THEN
    PERFORM pg_temp.assert_that('O11', true, 'last-active-ADMIN guard not exercised: other login-enabled ADMINs exist in this database');
  ELSE
    PERFORM pg_temp.expect_error('O11', format($q$UPDATE admin_user SET active = false WHERE admin_user_id = %L$q$, v_human), 'BV409', 'last active login-enabled ADMIN');
  END IF;
  PERFORM pg_temp.expect_error('O12', format($q$DELETE FROM admin_user WHERE admin_user_id = %L$q$, v_human), 'BV409', 'never deleted');

  PERFORM pg_temp.expect_error('O13',
    format($q$INSERT INTO admin_session (admin_user_id, token_hash, role_at_login, auth_issuer, expires_at) VALUES (%L, 'hash-technical', 'ADMIN', 'https://idp.example', now() + interval '1 hour')$q$, pg_temp.id('technical_admin')),
    'BV403', 'login-enabled');
  INSERT INTO admin_session (admin_user_id, token_hash, role_at_login, auth_issuer, expires_at) VALUES (v_human, 'hash-human', 'ADMIN', 'https://idp.example', now() + interval '1 hour')
    RETURNING session_id INTO v_session;
  PERFORM pg_temp.expect_error('O14', format($q$UPDATE admin_session SET token_hash = 'hash-replaced' WHERE session_id = %L$q$, v_session), 'BV409', 'immutable except');

  INSERT INTO admin_audit_event (actor_type, actor_admin_user_id, action, outcome) VALUES ('ADMIN_USER', v_human, 'project.viewed', 'ALLOWED');
  PERFORM pg_temp.expect_error('O15', format($q$UPDATE admin_audit_event SET outcome = 'DENIED' WHERE actor_admin_user_id = %L$q$, v_human), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('O16', $q$INSERT INTO admin_audit_event (actor_type, action, outcome) VALUES ('ADMIN_USER', 'project.viewed', 'ALLOWED')$q$, '23514', 'admin_audit_event_actor_consistency');
END $t$;

\echo '--- O17-O23: email outbox and job-run state machines ---'
DO $t$
DECLARE v_delivery UUID; v_run UUID; v_project UUID := pg_temp.id('project1'); v_person UUID := pg_temp.id('person1');
BEGIN
  PERFORM pg_temp.expect_error('O17',
    format($q$INSERT INTO email_delivery (dedupe_key, project_id, person_id, template, template_source, enqueued_by, status) VALUES ('ops-o17', %L, %L, 'resume_link', 'question_bank', 'suite', 'SENT')$q$, v_project, v_person),
    'BV409', 'always enqueued as PENDING');
  INSERT INTO email_delivery (dedupe_key, project_id, person_id, template, template_source, link_kind, enqueued_by) VALUES ('ops-suite-1', v_project, v_person, 'resume_link', 'question_bank', 'RESUME', 'suite')
    RETURNING delivery_id INTO v_delivery;
  PERFORM pg_temp.expect_error('O18',
    format($q$INSERT INTO email_delivery (dedupe_key, project_id, person_id, template, template_source, enqueued_by) VALUES ('ops-suite-1', %L, %L, 'resume_link', 'question_bank', 'suite')$q$, v_project, v_person),
    '23505', 'email_delivery_dedupe_key_unique');
  PERFORM pg_temp.expect_error('O19', format($q$UPDATE email_delivery SET status = 'SENT', sent_at = now(), finished_at = now() WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'cannot move from PENDING to SENT');
  PERFORM pg_temp.expect_error('O20', format($q$UPDATE email_delivery SET status = 'SENDING' WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'takes a lease and counts one attempt');
  UPDATE email_delivery SET status = 'SENDING', attempts = 1, lease_until = now() + interval '5 minutes' WHERE delivery_id = v_delivery;
  UPDATE email_delivery SET status = 'SENT', sent_at = now(), finished_at = now(), lease_until = NULL WHERE delivery_id = v_delivery;
  PERFORM pg_temp.expect_error('O21', format($q$UPDATE email_delivery SET status = 'PENDING', attempts = 0 WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'is final');

  INSERT INTO job_run (job_name, trigger) VALUES ('ops_suite_job', 'test') RETURNING run_id INTO v_run;
  PERFORM pg_temp.expect_error('O22', $q$INSERT INTO job_run (job_name, trigger) VALUES ('ops_suite_job', 'test')$q$, '23505', 'job_run_one_running_per_job');
  UPDATE job_run SET status = 'SUCCEEDED', finished_at = now(), stats = '{"sent": 1}' WHERE run_id = v_run;
  PERFORM pg_temp.expect_error('O23', format($q$UPDATE job_run SET stats = '{}' WHERE run_id = %L$q$, v_run), 'BV409', 'finished and immutable');
END $t$;

\echo '--- O24-O30: retention candidates and the purge ---'
DO $t$
DECLARE
  v_company2 UUID; v_person2 UUID; v_company3 UUID; v_person3 UUID;
  v_expired UUID; v_pending UUID; v_shared_a UUID; v_shared_b UUID;
  v_result JSONB;
  v_candidates UUID[];
BEGIN
  -- An abandoned free assessment with client data everywhere (its own person and company).
  INSERT INTO company (name, website) VALUES ('Abandoned Co', 'https://abandoned.example') RETURNING company_id INTO v_company2;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Aban', 'Doned', 'operations-suite-abandoned@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person2;
  v_expired := pg_temp.new_project('expired', v_company2, v_person2);
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at) VALUES (v_expired, now() - interval '70 days', now() - interval '70 days');
  INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (v_expired, 'fa.__ops_suite_field', '"secret story"', 'text', 'ops-suite-v1');
  INSERT INTO project_access_token (project_id, kind, token_hash, expires_at) VALUES (v_expired, 'RESUME', 'ops-suite-token-hash', now() + interval '1 day');
  INSERT INTO legal_acceptance (person_id, project_id, document, document_url, interface_language) VALUES (v_person2, v_expired, 'TERMS', 'https://www.beeside.you/termsandconditions', 'en');
  INSERT INTO email_delivery (dedupe_key, project_id, person_id, template, template_source, enqueued_by) VALUES ('ops-suite-expired', v_expired, v_person2, 'resume_link', 'question_bank', 'suite');
  INSERT INTO email_event (project_id, email_type, recipient, status, delivery_id)
    SELECT v_expired, 'resume_link', 'operations-suite-abandoned@example.test', 'SENT', delivery_id FROM email_delivery WHERE dedupe_key = 'ops-suite-expired';
  INSERT INTO fa_journey_event (event_type, project_id) VALUES ('ops_suite_event', v_expired);

  -- A completed free assessment with a pending Premium request awaiting beeside's confirmation.
  v_pending := pg_temp.new_project('pending', pg_temp.id('company1'), pg_temp.id('person1'));
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at) VALUES (v_pending, now() - interval '70 days', now() - interval '70 days');
  INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_pending, 'ops-suite-v1', 'ops-suite-v1', '{"kind": "expansion_snapshot"}');
  INSERT INTO internal_assessment (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_pending, 'ops-suite-v1', 'ops-suite-v1', '{"kind": "internal_assessment"}');
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v_pending;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO premium_activation_request (project_id, person_id, kind, terms_url, terms_accepted_at, interface_language, checkout_adapter)
    VALUES (v_pending, pg_temp.id('person1'), 'activation', 'https://www.beeside.you/termsandconditions', now(), 'en', 'manual_confirmation');

  -- Two projects of the same person: one already EXPIRED and past retention, one still live.
  INSERT INTO company (name) VALUES ('Shared Person Co') RETURNING company_id INTO v_company3;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Sha', 'Red', 'operations-suite-shared@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person3;
  v_shared_a := pg_temp.new_project('shared_a', v_company3, v_person3);
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at) VALUES (v_shared_a, now() - interval '70 days', now() - interval '70 days');
  UPDATE project SET assessment_state = 'EXPIRED' WHERE project_id = v_shared_a;
  v_shared_b := pg_temp.new_project('shared_b', v_company3, v_person3);
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at) VALUES (v_shared_b, now(), now());

  SELECT array_agg(project_id ORDER BY project_id) INTO v_candidates FROM fa_temporary_retention_candidates(now())
   WHERE project_id IN (v_expired, v_pending, v_shared_a, v_shared_b, pg_temp.id('project1'));
  PERFORM pg_temp.assert_that('O24', v_candidates = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[v_expired, v_shared_a]) AS x),
    'candidates: elapsed free assessments (IN_PROGRESS or EXPIRED); not a pending Premium request, not a project still within retention');

  v_result := fa_purge_temporary_project(v_pending, now(), NULL);
  PERFORM pg_temp.assert_that('O25', v_result = '{"purged": false, "reason": "premium_request_pending"}'::jsonb, 'the purge re-checks under lock: a pending Premium request wins');
  v_result := fa_purge_temporary_project(pg_temp.id('project1'), now(), NULL);
  PERFORM pg_temp.assert_that('O26', v_result ->> 'reason' = 'retention_not_reached', 'the purge refuses a project still within retention');

  v_result := fa_purge_temporary_project(v_expired, now(), NULL);
  PERFORM pg_temp.assert_that('O27',
    (v_result ->> 'purged')::boolean
      AND (SELECT assessment_state = 'DELETED' FROM project WHERE project_id = v_expired)
      AND (SELECT array_agg(to_state::text ORDER BY occurred_at, to_state) FROM assessment_state_transition WHERE project_id = v_expired) @> ARRAY['EXPIRED', 'DELETED']
      AND NOT EXISTS (SELECT 1 FROM answer WHERE project_id = v_expired)
      AND NOT EXISTS (SELECT 1 FROM project_access_token WHERE project_id = v_expired)
      AND NOT EXISTS (SELECT 1 FROM legal_acceptance WHERE project_id = v_expired)
      AND NOT EXISTS (SELECT 1 FROM email_delivery WHERE project_id = v_expired)
      AND NOT EXISTS (SELECT 1 FROM email_event WHERE project_id = v_expired)
      AND EXISTS (SELECT 1 FROM fa_journey_event WHERE project_id = v_expired)
      AND EXISTS (SELECT 1 FROM fa_project_lifecycle WHERE project_id = v_expired)
      AND (SELECT primary_email LIKE 'deleted-%@deleted.invalid' AND first_name = 'Deleted' FROM person WHERE person_id = v_person2)
      AND (SELECT name = 'Deleted company' AND website IS NULL FROM company WHERE company_id = v_company2)
      AND (SELECT (deleted_rows ->> 'answer')::int = 1 AND previous_state = 'IN_PROGRESS' FROM retention_purge_record WHERE project_id = v_expired),
    'IN_PROGRESS → EXPIRED → DELETED in one call: client data deleted, identity anonymized, anonymous analytics and lifecycle timestamps kept, evidence recorded');

  v_result := fa_purge_temporary_project(v_shared_a, now(), NULL);
  PERFORM pg_temp.assert_that('O28',
    (v_result ->> 'purged')::boolean AND NOT (v_result ->> 'person_anonymized')::boolean AND NOT (v_result ->> 'company_anonymized')::boolean
      AND (SELECT primary_email = 'operations-suite-shared@example.test' FROM person WHERE person_id = v_person3),
    'a person and company that still belong to a live project are never anonymized by another project''s purge');

  PERFORM pg_temp.expect_error('O29',
    format($q$DELETE FROM snapshot WHERE project_id = %L$q$, v_pending), 'P0001', 'is immutable');
  PERFORM pg_temp.expect_error('O30',
    format($q$UPDATE retention_purge_record SET purge_scope = 'other' WHERE project_id = %L$q$, v_expired), 'BV409', 'append-only');

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END $t$;

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
