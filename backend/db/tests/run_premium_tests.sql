-- Premium transition + Precision handoff + subscription boundary — integrity suite for 0009/0010 (S01–S30).
-- Entitlement semantics (a scheduled cancellation keeps access until the period ends), forward-only
-- subscription lifecycle, write-once Premium/Precision milestones, the exactly-once handoff package,
-- Operation Hub gating, activation requests, and the temporary-retention exclusion of Premium.
--
-- Runs inside ONE transaction that always ends in ROLLBACK; fixtures are addressed by the ids this
-- suite creates, so it is safe on a database that already holds configuration or other data.
-- Every assertion prints "<ID> PASS"; any unexpected error aborts psql (ON_ERROR_STOP).
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_premium_tests.sql
\set ON_ERROR_STOP on

BEGIN;

\echo '--- SETUP: helpers, test-only published versions, an IN_PROGRESS project ---'
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

CREATE FUNCTION pg_temp.setting(p_name TEXT) RETURNS UUID AS $$
BEGIN
  RETURN current_setting('pm_test.' || p_name)::uuid;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_admin UUID;
  v_registry config_registry;
  v_company UUID;
  v_person UUID;
  v_project UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'premium-suite@beeside.internal') RETURNING admin_user_id INTO v_admin;
  FOREACH v_registry IN ARRAY ARRAY['QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE']::config_registry[] LOOP
    PERFORM config_create_draft(v_registry, 'pm-suite-v1',
      CASE WHEN v_registry = 'QUESTION_BANK' THEN '{"schema_version": 1, "locales": ["en", "es"], "questions": [], "suite": "premium"}'
           ELSE '{"schema_version": 1, "locales": ["en", "es"], "suite": "premium"}' END::jsonb, v_admin);
    PERFORM config_submit_for_preview(v_registry, 'pm-suite-v1', v_admin);
    PERFORM config_record_review(v_registry, 'pm-suite-v1', v_admin, 'APPROVED', true, 'premium suite fixture');
    PERFORM config_publish(v_registry, 'pm-suite-v1', v_admin);
  END LOOP;

  INSERT INTO company (name) VALUES ('Premium Suite Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'Person', 'premium-suite@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_project;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_project;
  PERFORM set_config('pm_test.company', v_company::text, true);
  PERFORM set_config('pm_test.person', v_person::text, true);
  PERFORM set_config('pm_test.project', v_project::text, true);
  RAISE NOTICE 'SETUP OK: pm-suite-v1 current, project % IN_PROGRESS', v_project;
END $$;

\echo '--- S01: Premium is requested only after the First Assessment is complete ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('S01',
    format($q$INSERT INTO premium_activation_request (project_id, person_id, kind, terms_url, terms_accepted_at, interface_language, checkout_adapter)
              VALUES (%L, %L, 'activation', 'https://www.beeside.you/termsandconditions', now(), 'en', 'manual_confirmation')$q$,
           pg_temp.setting('project'), pg_temp.setting('person')),
    'BV409', 'only after the First Assessment is complete');

  -- Completion transaction: frozen Snapshot + Internal Assessment together with the lock.
  INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content)
    VALUES (pg_temp.setting('project'), 'pm-suite-v1', 'pm-suite-v1', '{"kind": "expansion_snapshot"}');
  INSERT INTO internal_assessment (project_id, rules_engine_version, snapshot_template_version, content)
    VALUES (pg_temp.setting('project'), 'pm-suite-v1', 'pm-suite-v1', '{"kind": "internal_assessment"}');
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = pg_temp.setting('project');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END $t$;

\echo '--- S02-S08: nothing Premium exists before the first activation ---'
DO $t$
DECLARE v_project UUID := pg_temp.setting('project');
BEGIN
  PERFORM pg_temp.expect_error('S02',
    format($q$INSERT INTO subscription (project_id, status, current_period_start, current_period_end) VALUES (%L, 'CANCELLATION_SCHEDULED', now(), now() + interval '30 days')$q$, v_project),
    'BV409', 'always starts as PREMIUM_ACTIVE');

  BEGIN
    INSERT INTO subscription (project_id, status, current_period_start, current_period_end) VALUES (v_project, 'PREMIUM_ACTIVE', now(), now() + interval '30 days');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'S03 FAIL: a subscription for a project that never entered Premium was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'BV409' AND SQLERRM LIKE '%never entered Premium%' THEN RAISE NOTICE 'S03 PASS: rejected [%] %', SQLSTATE, SQLERRM;
    ELSE RAISE; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  PERFORM pg_temp.expect_error('S04',
    format($q$INSERT INTO operation_hub_link (project_id, external_system, external_workspace_id) VALUES (%L, 'clickup', 'ws-1')$q$, v_project),
    'BV409', 'requires active Premium access');
  PERFORM pg_temp.expect_error('S05',
    format($q$UPDATE project SET precision_state = 'STARTED', precision_started_at = now() WHERE project_id = %L$q$, v_project),
    'BV409', 'Precision starts only with the first Premium activation');
  PERFORM pg_temp.expect_error('S06',
    format($q$UPDATE project SET premium_ever_activated = true WHERE project_id = %L$q$, v_project),
    'BV409', 'without premium_first_activated_at');
  PERFORM pg_temp.expect_error('S07',
    format($q$INSERT INTO precision_handoff_package (project_id, content, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
              SELECT %L, '{}'::jsonb, s.snapshot_id, i.internal_assessment_id, gen_random_uuid()
                FROM snapshot s JOIN internal_assessment i ON i.project_id = s.project_id WHERE s.project_id = %L$q$, v_project, v_project),
    'BV409', 'generated only when a locked First Assessment first enters Premium');
  PERFORM pg_temp.expect_error('S08',
    format($q$INSERT INTO subscription (project_id, status, current_period_start, current_period_end) VALUES (%L, 'PREMIUM_ACTIVE', now(), now() - interval '1 day')$q$, v_project),
    '23514', 'subscription_period_order');
END $t$;

\echo '--- S09-S16: first activation — entitlement, exactly-once handoff, write-once milestones ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.setting('project');
  v_start TIMESTAMPTZ := now() - interval '1 day';
  v_sub UUID;
  v_event UUID;
  v_ent entitlement%ROWTYPE;
BEGIN
  -- The same writes the subscription event processor performs, in the same order.
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (v_project, 'PREMIUM_ACTIVE', v_start, v_start + interval '30 days') RETURNING subscription_id INTO v_sub;
  UPDATE project SET premium_ever_activated = true, premium_first_activated_at = now() WHERE project_id = v_project;
  INSERT INTO subscription_event (subscription_id, project_id, event_type, source, idempotency_key)
    VALUES (v_sub, v_project, 'premium_activated', 'suite', 'suite-activation-1') RETURNING event_id INTO v_event;
  UPDATE project SET precision_state = 'STARTED', precision_started_at = now() WHERE project_id = v_project;
  INSERT INTO precision_handoff_package (project_id, content, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
    SELECT v_project, '{"contractVersion": 1}'::jsonb, s.snapshot_id, i.internal_assessment_id, v_event
      FROM snapshot s JOIN internal_assessment i ON i.project_id = s.project_id WHERE s.project_id = v_project;
  PERFORM set_config('pm_test.subscription1', v_sub::text, true);
  PERFORM set_config('pm_test.activation_event', v_event::text, true);

  SELECT * INTO v_ent FROM entitlement WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('S09', v_ent.premium_access_active AND v_ent.effective_from = v_start AND v_ent.effective_until IS NULL,
    'first activation grants access from the period start with no end date');
  PERFORM pg_temp.assert_that('S10',
    (SELECT count(*) FROM precision_handoff_package h JOIN snapshot s ON s.snapshot_id = h.source_snapshot_id
      WHERE h.project_id = v_project AND h.generated_by_event_id = v_event AND s.project_id = v_project) = 1,
    'the handoff package is generated by the premium_activated event from the project''s own frozen Snapshot');

  PERFORM pg_temp.expect_error('S11',
    format($q$INSERT INTO subscription_event (project_id, event_type, source) VALUES (%L, 'premium_activated', 'suite')$q$, v_project),
    '23505', 'subscription_event_one_premium_activated');
  PERFORM pg_temp.expect_error('S12',
    format($q$INSERT INTO precision_handoff_package (project_id, content, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
              SELECT %L, '{}'::jsonb, s.snapshot_id, i.internal_assessment_id, %L
                FROM snapshot s JOIN internal_assessment i ON i.project_id = s.project_id WHERE s.project_id = %L$q$, v_project, v_event, v_project),
    '23505', 'precision_handoff_package_project_id_unique');
  PERFORM pg_temp.expect_error('S13',
    format($q$INSERT INTO precision_handoff_package (project_id, content, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
              SELECT %L, '{}'::jsonb, gen_random_uuid(), i.internal_assessment_id, %L FROM internal_assessment i WHERE i.project_id = %L$q$, v_project, v_event, v_project),
    'BV409', 'its own frozen Snapshot and Internal Assessment');
  PERFORM pg_temp.expect_error('S14',
    format($q$INSERT INTO precision_handoff_package (project_id, content, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
              SELECT %L, '{}'::jsonb, s.snapshot_id, i.internal_assessment_id, gen_random_uuid()
                FROM snapshot s JOIN internal_assessment i ON i.project_id = s.project_id WHERE s.project_id = %L$q$, v_project, v_project),
    'BV409', 'generated by its premium_activated event');
  PERFORM pg_temp.expect_error('S15',
    format($q$UPDATE project SET premium_first_activated_at = now() + interval '1 day', precision_started_at = now() + interval '1 day' WHERE project_id = %L$q$, v_project),
    'BV409', 'write-once');

  INSERT INTO operation_hub_link (project_id, external_system, external_workspace_id) VALUES (v_project, 'clickup', 'ws-1');
  PERFORM pg_temp.expect_error('S16',
    format($q$DELETE FROM operation_hub_link WHERE project_id = %L$q$, v_project),
    'BV409', 'never deleted');
END $t$;

\echo '--- S17-S23: cancellation keeps access until the period ends; an ended subscription is never reopened ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.setting('project');
  v_sub UUID := pg_temp.setting('subscription1');
  v_ent entitlement%ROWTYPE;
  v_end TIMESTAMPTZ;
  v_ended TIMESTAMPTZ := now() + interval '1 hour';
BEGIN
  PERFORM pg_temp.expect_error('S17',
    format($q$UPDATE subscription SET status = 'CANCELLATION_SCHEDULED' WHERE subscription_id = %L$q$, v_sub),
    'BV409', 'records cancel_at_period_end and cancellation_requested_at');

  UPDATE subscription SET status = 'CANCELLATION_SCHEDULED', cancel_at_period_end = true, cancellation_requested_at = now() WHERE subscription_id = v_sub
    RETURNING current_period_end INTO v_end;
  SELECT * INTO v_ent FROM entitlement WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('S18', v_ent.premium_access_active AND v_ent.effective_until = v_end,
    'a scheduled cancellation keeps premium_access_active=true until current_period_end (Phase 2 sync corrected)');

  PERFORM pg_temp.expect_error('S19',
    format($q$UPDATE subscription SET status = 'PREMIUM_ACTIVE' WHERE subscription_id = %L$q$, v_sub),
    'BV409', 'cannot move from CANCELLATION_SCHEDULED to PREMIUM_ACTIVE');
  PERFORM pg_temp.expect_error('S20',
    format($q$UPDATE subscription SET status = 'PREMIUM_INACTIVE' WHERE subscription_id = %L$q$, v_sub),
    'BV409', 'records ended_at');

  UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = v_ended WHERE subscription_id = v_sub;
  SELECT * INTO v_ent FROM entitlement WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('S21',
    NOT v_ent.premium_access_active AND v_ent.effective_until = v_ended
      AND (SELECT premium_ever_activated AND precision_state = 'STARTED' FROM project WHERE project_id = v_project),
    'the period end removes current access, while premium_ever_activated and precision_state stay as historical facts');

  PERFORM pg_temp.expect_error('S22',
    format($q$UPDATE subscription SET current_period_end = current_period_end + interval '30 days' WHERE subscription_id = %L$q$, v_sub),
    'BV409', 'never reopened');
  PERFORM pg_temp.expect_error('S23',
    format($q$DELETE FROM subscription WHERE subscription_id = %L$q$, v_sub),
    'BV409', 'never deleted');
END $t$;

\echo '--- S24-S25: reactivation reuses the project, opens a new subscription, never a second package ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.setting('project');
  v_start TIMESTAMPTZ := now() + interval '2 hours';
  v_sub UUID;
  v_event UUID;
  v_ent entitlement%ROWTYPE;
BEGIN
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (v_project, 'PREMIUM_ACTIVE', v_start, v_start + interval '30 days') RETURNING subscription_id INTO v_sub;
  INSERT INTO subscription_event (subscription_id, project_id, event_type, source, idempotency_key)
    VALUES (v_sub, v_project, 'premium_reactivated', 'suite', 'suite-reactivation-1') RETURNING event_id INTO v_event;
  PERFORM set_config('pm_test.reactivation_event', v_event::text, true);
  SELECT * INTO v_ent FROM entitlement WHERE project_id = v_project;
  PERFORM pg_temp.assert_that('S24',
    v_ent.premium_access_active AND v_ent.effective_from = v_start AND v_ent.effective_until IS NULL
      AND (SELECT count(*) FROM subscription WHERE project_id = v_project) = 2
      AND (SELECT count(*) FROM precision_handoff_package WHERE project_id = v_project) = 1
      AND (SELECT count(*) FROM subscription_state_transition WHERE project_id = v_project) = 4,
    'reactivation: same project_id, a second subscription row, access active again, still exactly one handoff package');

  PERFORM pg_temp.expect_error('S25',
    format($q$INSERT INTO subscription_event (subscription_id, project_id, event_type, source) VALUES (gen_random_uuid(), %L, 'cancellation_requested', 'suite')$q$, v_project),
    'BV409', 'references a subscription of another project');
END $t$;

\echo '--- S26-S28: activation requests record Terms acceptance and are fulfilled only by an activation event ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.setting('project');
  v_person UUID := pg_temp.setting('person');
  v_request UUID;
BEGIN
  PERFORM pg_temp.expect_error('S26',
    format($q$INSERT INTO premium_activation_request (project_id, person_id, kind, status, terms_url, terms_accepted_at, interface_language, checkout_adapter)
              VALUES (%L, %L, 'reactivation', 'FULFILLED', 'https://www.beeside.you/termsandconditions', now(), 'en', 'manual_confirmation')$q$, v_project, v_person),
    '23514', 'premium_activation_request_fulfilment');

  INSERT INTO premium_activation_request (project_id, person_id, kind, terms_url, terms_accepted_at, interface_language, checkout_adapter)
    VALUES (v_project, v_person, 'reactivation', 'https://www.beeside.you/termsandconditions', now(), 'es', 'manual_confirmation') RETURNING request_id INTO v_request;
  PERFORM pg_temp.expect_error('S27',
    format($q$UPDATE premium_activation_request SET terms_accepted_at = now() - interval '1 day' WHERE request_id = %L$q$, v_request),
    'BV409', 'is immutable except');

  UPDATE premium_activation_request SET status = 'FULFILLED', fulfilled_at = now(), fulfilled_by_event_id = pg_temp.setting('reactivation_event') WHERE request_id = v_request;
  PERFORM pg_temp.expect_error('S28',
    format($q$UPDATE premium_activation_request SET status = 'REQUESTED', fulfilled_at = NULL, fulfilled_by_event_id = NULL WHERE request_id = %L$q$, v_request),
    'BV409', 'already fulfilled');
END $t$;

\echo '--- S29-S30: temporary retention never selects a project that entered Premium; First Assessment untouched ---'
DO $t$
DECLARE
  v_company UUID := pg_temp.setting('company');
  v_person UUID := pg_temp.setting('person');
  v_premium UUID := pg_temp.setting('project');
  v_expired UUID;
  v_future UUID;
  v_draft UUID;
  v_candidates UUID[];
BEGIN
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_expired;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_expired;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_future;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_future;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_draft;

  INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at, access_window_started_at, access_expires_at, access_max_until, retention_until)
  VALUES
    (v_premium, now() - interval '70 days', now() - interval '70 days', now() - interval '70 days', now() - interval '55 days', now() - interval '25 days', now() - interval '10 days'),
    (v_expired, now() - interval '70 days', now() - interval '70 days', now() - interval '70 days', now() - interval '55 days', now() - interval '25 days', now() - interval '10 days'),
    (v_future,  now() - interval '5 days',  now() - interval '5 days',  now() - interval '5 days',  now() + interval '10 days', now() + interval '40 days', now() + interval '55 days'),
    (v_draft,   now() - interval '70 days', now() - interval '70 days', now() - interval '70 days', now() - interval '55 days', now() - interval '25 days', now() - interval '10 days');

  SELECT array_agg(project_id) INTO v_candidates FROM fa_temporary_retention_candidates(now()) WHERE project_id IN (v_premium, v_expired, v_future, v_draft);
  PERFORM pg_temp.assert_that('S29', v_candidates = ARRAY[v_expired],
    'only the expired non-Premium assessment is a retention candidate; the Premium project is excluded despite its past retention date');

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.assert_that('S30',
    (SELECT assessment_state = 'COMPLETED_LOCKED' FROM project WHERE project_id = v_premium)
      AND (SELECT content = '{"kind": "expansion_snapshot"}'::jsonb FROM snapshot WHERE project_id = v_premium)
      AND (SELECT content = '{"kind": "internal_assessment"}'::jsonb FROM internal_assessment WHERE project_id = v_premium),
    'no subscription event touched the First Assessment: still COMPLETED_LOCKED with its frozen Snapshot and Internal Assessment; every deferred check holds');
END $t$;

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
