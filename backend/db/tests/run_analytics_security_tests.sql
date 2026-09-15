-- Analytics, Integrations & Security Hardening — integrity suite for migrations 0013/0014 (A01–A28).
-- Post-Snapshot feedback (after the Snapshot, once, immutable), the anonymous analytics profile
-- (enumerations only, never deleted), the outbound integration delivery state machine, the purge
-- extended to feedback and integration deliveries (plus the destination delete signal), and the
-- least-privilege runtime database role.
--
-- Runs inside ONE transaction that always ends in ROLLBACK; fixtures are addressed by the ids this
-- suite creates, so it is safe on a database that already holds configuration or other data.
-- Every assertion prints "<ID> PASS"; any unexpected error aborts psql (ON_ERROR_STOP).
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_analytics_security_tests.sql
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
  RETURN current_setting('sec_test.' || p_name)::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.new_project(p_name TEXT, p_company UUID, p_person UUID) RETURNS UUID AS $$
DECLARE v_project UUID;
BEGIN
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (p_company, p_person, p_person) RETURNING project_id INTO v_project;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_project;
  PERFORM set_config('sec_test.' || p_name, v_project::text, true);
  RETURN v_project;
END;
$$ LANGUAGE plpgsql;

-- A completed assessment with its frozen Snapshot and Internal Assessment (what feedback needs).
CREATE FUNCTION pg_temp.complete_project(p_project UUID) RETURNS void AS $$
DECLARE v_rules TEXT; v_template TEXT;
BEGIN
  SELECT rules_engine_version, snapshot_template_version INTO v_rules, v_template FROM project WHERE project_id = p_project;
  INSERT INTO snapshot (project_id, generated_at, rules_engine_version, snapshot_template_version, content)
    VALUES (p_project, now(), v_rules, v_template, '{"suite": "analytics-security"}'::jsonb);
  INSERT INTO internal_assessment (project_id, generated_at, rules_engine_version, snapshot_template_version, content)
    VALUES (p_project, now(), v_rules, v_template, '{"suite": "analytics-security"}'::jsonb);
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = p_project;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_admin UUID;
  v_registry config_registry;
  v_company UUID;
  v_person UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'analytics-security-suite@beeside.internal') RETURNING admin_user_id INTO v_admin;
  FOREACH v_registry IN ARRAY ARRAY['QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE']::config_registry[] LOOP
    PERFORM config_create_draft(v_registry, 'sec-suite-v1',
      CASE WHEN v_registry = 'QUESTION_BANK' THEN '{"schema_version": 1, "locales": ["en", "es"], "questions": [], "suite": "analytics-security"}'
           ELSE '{"schema_version": 1, "locales": ["en", "es"], "suite": "analytics-security"}' END::jsonb, v_admin);
    PERFORM config_submit_for_preview(v_registry, 'sec-suite-v1', v_admin);
    PERFORM config_record_review(v_registry, 'sec-suite-v1', v_admin, 'APPROVED', true, 'analytics/security suite fixture');
    PERFORM config_publish(v_registry, 'sec-suite-v1', v_admin);
  END LOOP;

  INSERT INTO company (name) VALUES ('Analytics Security Suite Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'Analytics', 'analytics-security-suite@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  PERFORM set_config('sec_test.company1', v_company::text, true);
  PERFORM set_config('sec_test.person1', v_person::text, true);
  PERFORM pg_temp.new_project('project1', v_company, v_person);
  PERFORM pg_temp.new_project('project2', v_company, v_person);
  PERFORM pg_temp.new_project('purge_project', v_company, v_person);
  RAISE NOTICE 'SETUP OK: sec-suite-v1 current';
END $$;

\echo '--- A01-A07: post-Snapshot feedback (after the Snapshot, once, immutable) ---'
DO $t$
DECLARE v_project UUID := pg_temp.id('project1'); v_other UUID := pg_temp.id('project2'); v_feedback UUID;
BEGIN
  PERFORM pg_temp.expect_error('A01',
    format($q$INSERT INTO snapshot_feedback (project_id, question_version, usefulness, channel, interface_language) VALUES (%L, 'snapshot-feedback-v1', 4, 'session', 'en')$q$, v_project),
    'BV409', 'completed First Assessment');

  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v_other;
  PERFORM pg_temp.expect_error('A02',
    format($q$INSERT INTO snapshot_feedback (project_id, question_version, usefulness, channel, interface_language) VALUES (%L, 'snapshot-feedback-v1', 4, 'session', 'en')$q$, v_other),
    'BV409', 'after the Snapshot');
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_other;

  PERFORM pg_temp.complete_project(v_project);
  INSERT INTO snapshot_feedback (project_id, question_version, usefulness, comment, channel, interface_language)
    VALUES (v_project, 'snapshot-feedback-v1', 5, 'The panels made the gaps obvious.', 'session', 'en') RETURNING feedback_id INTO v_feedback;
  PERFORM pg_temp.assert_that('A03', (SELECT usefulness = 5 AND comment IS NOT NULL FROM snapshot_feedback WHERE feedback_id = v_feedback),
    'feedback is accepted once the Snapshot exists, with its optional comment');

  PERFORM pg_temp.expect_error('A04',
    format($q$INSERT INTO snapshot_feedback (project_id, question_version, usefulness, channel, interface_language) VALUES (%L, 'snapshot-feedback-v1', 2, 'private_link', 'es')$q$, v_project),
    '23505', 'snapshot_feedback_project_unique');
  PERFORM pg_temp.expect_error('A05', format($q$UPDATE snapshot_feedback SET usefulness = 1 WHERE feedback_id = %L$q$, v_feedback), 'BV409', 'immutable once submitted');
  PERFORM pg_temp.expect_error('A06', format($q$DELETE FROM snapshot_feedback WHERE feedback_id = %L$q$, v_feedback), 'BV409', 'never deleted');
  -- The rating range is checked on a project that may legitimately answer (the guard runs first).
  PERFORM pg_temp.complete_project(pg_temp.id('purge_project'));
  PERFORM pg_temp.expect_error('A07',
    format($q$INSERT INTO snapshot_feedback (project_id, question_version, usefulness, channel, interface_language) VALUES (%L, 'snapshot-feedback-v1', 6, 'session', 'en')$q$, pg_temp.id('purge_project')),
    '23514', 'snapshot_feedback_usefulness');
END $t$;

\echo '--- A08-A13: the analytics profile carries enumerations only and is never deleted ---'
DO $t$
DECLARE v_project UUID := pg_temp.id('project2');
BEGIN
  INSERT INTO analytics_project_profile (project_id, question_bank_version, primary_goal, project_stage, entry_mode, business_type, target_markets, expected_capabilities)
    VALUES (v_project, 'sec-suite-v1', 'set_up_local_operation', 'preparing_entry', 'new_market', 'manufacturing', ARRAY['MX'], ARRAY['legal_corporate']);
  PERFORM pg_temp.assert_that('A08', (SELECT completed_at IS NULL AND signal_areas = '{}'::jsonb FROM analytics_project_profile WHERE project_id = v_project),
    'a profile starts without completion facts and without finding signals');

  PERFORM pg_temp.expect_error('A09', format($q$UPDATE analytics_project_profile SET target_markets = ARRAY['Mexico'] WHERE project_id = %L$q$, v_project), 'BV422', 'ISO country codes only');
  PERFORM pg_temp.expect_error('A10', format($q$UPDATE analytics_project_profile SET expected_capabilities = ARRAY['Legal Corporate S.A.'] WHERE project_id = %L$q$, v_project), 'BV422', 'enumerated option values only');
  PERFORM pg_temp.expect_error('A11', format($q$UPDATE analytics_project_profile SET signal_areas = '{"NEEDS_ATTENTION": ["Monterrey plant"]}'::jsonb WHERE project_id = %L$q$, v_project), 'BV422', 'area identifiers only');
  PERFORM pg_temp.expect_error('A12', format($q$UPDATE analytics_project_profile SET primary_goal = 'Enter the US market' WHERE project_id = %L$q$, v_project), '23514', 'analytics_project_profile_enumerations');

  UPDATE analytics_project_profile SET completed_at = now(), signal_areas = '{"NEEDS_ATTENTION": ["customs_trade"]}'::jsonb WHERE project_id = v_project;
  PERFORM pg_temp.expect_error('A13', format($q$UPDATE analytics_project_profile SET completed_at = now() + interval '1 day' WHERE project_id = %L$q$, v_project), 'BV409', 'written once');
  PERFORM pg_temp.expect_error('A14', format($q$DELETE FROM analytics_project_profile WHERE project_id = %L$q$, v_project), 'BV409', 'never deleted');
END $t$;

\echo '--- A15-A22: outbound integration delivery state machine ---'
DO $t$
DECLARE v_project UUID := pg_temp.id('project1'); v_event BIGINT; v_event_id UUID; v_delivery UUID;
BEGIN
  INSERT INTO outbox_event (project_id, event_type, payload) VALUES (v_project, 'assessment.completed', jsonb_build_object('project_id', v_project))
    RETURNING outbox_event_id, event_id INTO v_event, v_event_id;

  PERFORM pg_temp.expect_error('A15',
    format($q$INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id) VALUES (%s, %L, 'smartsuite', 'premium.activation_requested', %L)$q$, v_event, v_event_id, v_project),
    'BV409', 'mirror its outbox event');
  PERFORM pg_temp.expect_error('A16',
    format($q$INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id, status) VALUES (%s, %L, 'smartsuite', 'assessment.completed', %L, 'DELIVERED')$q$, v_event, v_event_id, v_project),
    'BV409', 'always created as PENDING');

  INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id)
    VALUES (v_event, v_event_id, 'smartsuite', 'assessment.completed', v_project) RETURNING delivery_id INTO v_delivery;
  PERFORM pg_temp.expect_error('A17',
    format($q$INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id) VALUES (%s, %L, 'smartsuite', 'assessment.completed', %L)$q$, v_event, v_event_id, v_project),
    '23505', 'integration_delivery_event_destination_unique');

  PERFORM pg_temp.expect_error('A18', format($q$UPDATE integration_delivery SET status = 'SENDING' WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'takes a lease and counts one attempt');
  PERFORM pg_temp.expect_error('A19', format($q$UPDATE integration_delivery SET status = 'DELIVERED', delivered_at = now(), finished_at = now(), adapter_name = 'x' WHERE delivery_id = %L$q$, v_delivery),
    'BV409', 'cannot move from PENDING to DELIVERED');

  UPDATE integration_delivery SET status = 'SENDING', attempts = 1, lease_until = now() + interval '5 minutes' WHERE delivery_id = v_delivery;
  PERFORM pg_temp.expect_error('A20', format($q$UPDATE integration_delivery SET status = 'SKIPPED', finished_at = now() WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'records its reason');
  UPDATE integration_delivery SET status = 'FAILED', last_error = 'smartsuite request failed', lease_until = NULL, next_attempt_at = now() + interval '1 minute' WHERE delivery_id = v_delivery;
  PERFORM pg_temp.expect_error('A21', format($q$UPDATE integration_delivery SET status = 'PENDING' WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'restarts its attempt count');
  UPDATE integration_delivery SET status = 'PENDING', attempts = 0, next_attempt_at = now() WHERE delivery_id = v_delivery;
  UPDATE integration_delivery SET status = 'SENDING', attempts = 1, lease_until = now() + interval '5 minutes' WHERE delivery_id = v_delivery;
  UPDATE integration_delivery SET status = 'DELIVERED', delivered_at = now(), finished_at = now(), lease_until = NULL, adapter_name = 'smartsuite_capture', external_reference = 'capture-1' WHERE delivery_id = v_delivery;
  PERFORM pg_temp.expect_error('A22', format($q$UPDATE integration_delivery SET status = 'PENDING', attempts = 0 WHERE delivery_id = %L$q$, v_delivery), 'BV409', 'is final');

  INSERT INTO integration_external_ref (destination, project_id, external_id) VALUES ('smartsuite', v_project, 'capture-1');
  PERFORM pg_temp.expect_error('A23', format($q$UPDATE integration_external_ref SET project_id = %L WHERE destination = 'smartsuite' AND project_id = %L$q$, pg_temp.id('project2'), v_project),
    'BV409', 'identity is immutable');
END $t$;

\echo '--- A24-A25: rate-limit counters never store an address, email or token in clear ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('A24',
    $q$INSERT INTO rate_limit_counter (bucket_key, window_start, policy, hits, max_hits, expires_at) VALUES ('fa_identity_address:203.0.113.10', now(), 'fa_identity_address', 1, 10, now() + interval '20 minutes')$q$,
    '23514', 'rate_limit_counter_key_format');
  INSERT INTO rate_limit_counter (bucket_key, window_start, policy, hits, max_hits, expires_at)
    VALUES ('fa_identity_address:' || encode(sha256('probe'::bytea), 'hex'), date_trunc('hour', now()), 'fa_identity_address', 1, 10, now() + interval '20 minutes');
  PERFORM pg_temp.assert_that('A25', (SELECT count(*) = 1 FROM rate_limit_counter WHERE policy = 'fa_identity_address' AND bucket_key ~ '^fa_identity_address:[0-9a-f]{64}$'),
    'counters are keyed by an HMAC digest only');
END $t$;

\echo '--- A26: the purge removes the feedback comment and pending deliveries, keeps anonymous analytics, and tells destinations to delete their copy ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.id('purge_project');
  v_result JSONB;
  v_event BIGINT;
  v_event_id UUID;
BEGIN
  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at, completed_at)
    VALUES (v_project, now() - interval '100 days', now() - interval '100 days', now() - interval '95 days');
  INSERT INTO snapshot_feedback (project_id, question_version, usefulness, comment, channel, interface_language)
    VALUES (v_project, 'snapshot-feedback-v1', 3, 'Please call me on my mobile.', 'private_link', 'es');
  INSERT INTO analytics_project_profile (project_id, question_bank_version, primary_goal, target_markets, completed_at)
    VALUES (v_project, 'sec-suite-v1', 'enter_first_time', ARRAY['MX'], now() - interval '95 days');
  INSERT INTO outbox_event (project_id, event_type, payload) VALUES (v_project, 'assessment.completed', jsonb_build_object('project_id', v_project))
    RETURNING outbox_event_id, event_id INTO v_event, v_event_id;
  INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id)
    VALUES (v_event, v_event_id, 'smartsuite', 'assessment.completed', v_project);
  INSERT INTO integration_external_ref (destination, project_id, external_id) VALUES ('smartsuite', v_project, 'ss-record-42');

  SELECT fa_purge_temporary_project(v_project, now(), NULL) INTO v_result;
  PERFORM pg_temp.assert_that('A26', (v_result ->> 'purged')::boolean
      AND (v_result -> 'deleted_rows' ->> 'snapshot_feedback')::int = 1
      AND (v_result -> 'deleted_rows' ->> 'integration_delivery')::int = 1,
    'the purge deletes the feedback (comment included) and the project''s integration deliveries');
  PERFORM pg_temp.assert_that('A27',
    (SELECT count(*) = 0 FROM snapshot_feedback WHERE project_id = v_project)
      AND (SELECT count(*) = 1 FROM analytics_project_profile WHERE project_id = v_project)
      AND (SELECT count(*) = 1 FROM integration_external_ref WHERE project_id = v_project),
    'anonymous analytics and the external cross-reference survive; client content does not');
  PERFORM pg_temp.assert_that('A28',
    (SELECT count(*) = 1 FROM outbox_event WHERE project_id = v_project AND event_type = 'retention.project_purged'),
    'destinations are told to delete their own copy (ids only)');
END $t$;

\echo '--- A29-A32: least-privilege runtime database role ---'
DO $t$
DECLARE v_role TEXT := 'beeside_runtime_role';
BEGIN
  PERFORM pg_temp.assert_that('A29',
    (SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls FROM pg_roles WHERE rolname = v_role),
    'the runtime role cannot log in by itself, is not a superuser and manages nothing');
  PERFORM pg_temp.assert_that('A30',
    has_table_privilege(v_role, 'answer', 'SELECT') AND has_table_privilege(v_role, 'answer', 'INSERT') AND has_table_privilege(v_role, 'answer', 'UPDATE')
      AND has_table_privilege(v_role, 'answer', 'DELETE') AND has_table_privilege(v_role, 'snapshot_feedback', 'INSERT'),
    'the runtime role can do what the application does, including the retention purge');
  PERFORM pg_temp.assert_that('A31',
    NOT has_table_privilege(v_role, 'fa_journey_event', 'UPDATE') AND NOT has_table_privilege(v_role, 'fa_journey_event', 'DELETE')
      AND NOT has_table_privilege(v_role, 'admin_audit_event', 'UPDATE') AND NOT has_table_privilege(v_role, 'snapshot_feedback', 'UPDATE')
      AND NOT has_table_privilege(v_role, 'analytics_project_profile', 'DELETE') AND NOT has_table_privilege(v_role, 'retention_purge_record', 'UPDATE'),
    'append-only and anonymous-analytics tables cannot be rewritten by the running application');
  PERFORM pg_temp.assert_that('A32',
    NOT has_schema_privilege(v_role, 'public', 'CREATE')
      AND NOT has_table_privilege(v_role, 'drizzle.__drizzle_migrations', 'INSERT')
      AND has_table_privilege(v_role, 'drizzle.__drizzle_migrations', 'SELECT')
      AND EXISTS (SELECT 1 FROM pg_default_acl a JOIN pg_roles r ON r.oid = a.defaclrole WHERE a.defaclnamespace = 'public'::regnamespace AND a.defaclobjtype = 'r'),
    'the runtime role cannot change the schema or the migration registry, and future tables inherit the same grants');
END $t$;

ROLLBACK;
