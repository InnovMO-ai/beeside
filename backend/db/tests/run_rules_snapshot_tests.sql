-- Rules + Snapshot — integrity test suite for migrations 0007/0008 (R01–R14).
-- Finding explainability, pinned rules engine, no rule output after the lock, and the Snapshot /
-- Internal Assessment generated together with the COMPLETED_LOCKED transition.
--
-- Runs inside ONE transaction that always ends in ROLLBACK; fixtures are addressed by the ids this
-- suite creates, so it is safe on a database that already holds configuration or other data.
-- Every assertion prints "<ID> PASS"; any unexpected error aborts psql (ON_ERROR_STOP).
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/run_rules_snapshot_tests.sql
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

CREATE FUNCTION pg_temp.project() RETURNS UUID AS $$
BEGIN
  RETURN current_setting('rs_test.project')::uuid;
END;
$$ LANGUAGE plpgsql;

-- Inserts a finding; every argument after the status defaults to a valid, explainable row.
CREATE FUNCTION pg_temp.finding_sql(
  p_area INT, p_status TEXT, p_reason TEXT DEFAULT '''A clear reason.''', p_rule TEXT DEFAULT '''area.test.rule''',
  p_version TEXT DEFAULT '''rs-suite-v1''', p_strength TEXT DEFAULT '''SUPPORTING''', p_signal TEXT DEFAULT '''Test signal'''
) RETURNS TEXT AS $$
BEGIN
  RETURN format(
    'INSERT INTO finding (project_id, area_id, status, reason_client, rule_triggered, reason_internal, signal_strength, internal_signal, rules_engine_version)
     VALUES (%L, %s, %L, %s, %s, ''internal reason'', %s, %s, %s)',
    pg_temp.project(), p_area, p_status, p_reason, p_rule, p_strength, p_signal, p_version);
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
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'rules-snapshot-suite@beeside.internal') RETURNING admin_user_id INTO v_admin;
  FOREACH v_registry IN ARRAY ARRAY['QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE']::config_registry[] LOOP
    PERFORM config_create_draft(v_registry, 'rs-suite-v1',
      CASE WHEN v_registry = 'QUESTION_BANK' THEN '{"schema_version": 1, "locales": ["en", "es"], "questions": [], "suite": "rules-snapshot"}'
           ELSE '{"schema_version": 1, "locales": ["en", "es"], "suite": "rules-snapshot"}' END::jsonb, v_admin);
    PERFORM config_submit_for_preview(v_registry, 'rs-suite-v1', v_admin);
    PERFORM config_record_review(v_registry, 'rs-suite-v1', v_admin, 'APPROVED', true, 'rules snapshot suite fixture');
    PERFORM config_publish(v_registry, 'rs-suite-v1', v_admin);
  END LOOP;

  INSERT INTO company (name) VALUES ('Rules Snapshot Suite Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Suite', 'Person', 'rules-snapshot-suite@example.test', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES (v_company, v_person, v_person) RETURNING project_id INTO v_project;
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_project;
  PERFORM set_config('rs_test.project', v_project::text, true);
  RAISE NOTICE 'SETUP OK: rs-suite-v1 current, project % IN_PROGRESS', v_project;
END $$;

\echo '--- R01-R06: every finding is explainable and NOT_APPLICABLE carries nothing client-facing ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('R01', pg_temp.finding_sql(1, 'DEFINED', p_rule => $q$''$q$), '23514', 'finding_rule_explained');
  PERFORM pg_temp.expect_error('R02', pg_temp.finding_sql(1, 'NEEDS_ATTENTION', p_reason => 'NULL'), '23514', 'finding_reason_client_when_shown');
  PERFORM pg_temp.expect_error('R03', pg_temp.finding_sql(2, 'NOT_APPLICABLE', p_reason => 'NULL', p_strength => $q$'STRONG'$q$), '23514', 'finding_not_applicable_without_signal');
  PERFORM pg_temp.expect_error('R04', pg_temp.finding_sql(1, 'DEFINED', p_version => $q$'rs-not-pinned'$q$), 'BV409', 'does not match the project''s pinned version');
  EXECUTE pg_temp.finding_sql(1, 'DEFINED');
  EXECUTE pg_temp.finding_sql(2, 'NOT_APPLICABLE', p_reason => 'NULL', p_strength => $q$'NO_SIGNAL'$q$, p_signal => 'NULL');
  PERFORM pg_temp.assert_that('R05',
    (SELECT count(*) FROM finding WHERE project_id = pg_temp.project() AND source_type = 'DERIVED_BY_RULE') = 2,
    'explainable findings (including a silent NOT_APPLICABLE) are accepted on the pinned rules engine while IN_PROGRESS');
  PERFORM pg_temp.expect_error('R06',
    format($q$INSERT INTO capability_rank (project_id, category_id, rank, rules_engine_version) VALUES (%L, 1, 0, 'rs-suite-v1')$q$, pg_temp.project()),
    '23514', 'capability_rank_positive');
  INSERT INTO capability_rank (project_id, category_id, rank, included_in_snapshot, source_area_ids, ranking_factors, rules_engine_version)
    VALUES (pg_temp.project(), 1, 1, true, '{2}', '{"operational_dependency": true}', 'rs-suite-v1');
  INSERT INTO priority_alignment (project_id, alignment, rules_engine_version) VALUES (pg_temp.project(), 'ALIGNED', 'rs-suite-v1');
END $t$;

\echo '--- R07-R10: Snapshot and Internal Assessment use pinned versions and are generated together with the lock ---'
DO $t$
DECLARE v_project UUID := pg_temp.project();
BEGIN
  PERFORM pg_temp.expect_error('R07',
    format($q$INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content) VALUES (%L, 'rs-suite-v1', 'rs-other', '{}')$q$, v_project),
    'BV409', 'must use the pinned versions');

  BEGIN
    INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_project, 'rs-suite-v1', 'rs-suite-v1', '{}');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'R08 FAIL: a Snapshot without its Internal Assessment was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'BV409' AND SQLERRM LIKE '%must be generated together%' THEN RAISE NOTICE 'R08 PASS: rejected [%] %', SQLSTATE, SQLERRM;
    ELSE RAISE; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_project, 'rs-suite-v1', 'rs-suite-v1', '{}');
    INSERT INTO internal_assessment (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_project, 'rs-suite-v1', 'rs-suite-v1', '{}');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'R09 FAIL: a Snapshot for an unlocked First Assessment was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'BV409' AND SQLERRM LIKE '%requires its First Assessment to be COMPLETED_LOCKED%' THEN RAISE NOTICE 'R09 PASS: rejected [%] %', SQLSTATE, SQLERRM;
    ELSE RAISE; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  PERFORM pg_temp.expect_error('R10',
    format($q$INSERT INTO internal_assessment (project_id, rules_engine_version, snapshot_template_version, content) VALUES (%L, 'rs-suite-v1', 'rs-suite-v1', '[]')$q$, v_project),
    '23514', 'internal_assessment_content_object');
END $t$;

\echo '--- R11-R14: the completion transaction, then everything is frozen ---'
DO $t$
DECLARE v_project UUID := pg_temp.project();
BEGIN
  INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_project, 'rs-suite-v1', 'rs-suite-v1', '{"kind": "expansion_snapshot"}');
  INSERT INTO internal_assessment (project_id, rules_engine_version, snapshot_template_version, content) VALUES (v_project, 'rs-suite-v1', 'rs-suite-v1', '{"kind": "internal_assessment"}');
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v_project;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.assert_that('R11',
    EXISTS (SELECT 1 FROM snapshot WHERE project_id = v_project) AND EXISTS (SELECT 1 FROM internal_assessment WHERE project_id = v_project),
    'findings, Snapshot and Internal Assessment generated in the transaction that locks the First Assessment satisfy every deferred check');

  PERFORM pg_temp.expect_error('R12', pg_temp.finding_sql(3, 'DEFINED'), 'BV409', 'can no longer be added');
  PERFORM pg_temp.expect_error('R13',
    format($q$INSERT INTO capability_rank (project_id, category_id, rank, rules_engine_version) VALUES (%L, 2, 2, 'rs-suite-v1')$q$, v_project),
    'BV409', 'can no longer be added');
  PERFORM pg_temp.expect_error('R14',
    format($q$UPDATE snapshot SET content = '{"tampered": true}' WHERE project_id = %L$q$, v_project),
    'P0001', 'is immutable');
END $t$;

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
