-- Macroblock 4 — Precision persistence acid-test suite.
-- Runs inside ONE transaction that always ends in ROLLBACK; any failed assertion aborts psql
-- (ON_ERROR_STOP), which also discards the transaction. Every assertion prints "<ID> PASS".
-- Usage (from backend/): psql "$DATABASE_URL" -X -f db/tests/precision/run_precision_tests.sql
\set ON_ERROR_STOP on
\set qb_placeholder `cat db/config-bundles/placeholder/question-bank.json`
\set re_placeholder `cat db/config-bundles/placeholder/rules-engine.json`
\set st_placeholder `cat db/config-bundles/placeholder/snapshot-template.json`

BEGIN;

SELECT set_config('pt.qb_placeholder', :'qb_placeholder', true),
       set_config('pt.re_placeholder', :'re_placeholder', true),
       set_config('pt.st_placeholder', :'st_placeholder', true) \g /dev/null

\echo '--- SETUP: actors, companies, projects, fixture manifests ---'
CREATE FUNCTION pg_temp.expect_error(
  p_label TEXT, p_sql TEXT, p_sqlstate TEXT, p_message_like TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
  BEGIN
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

CREATE FUNCTION pg_temp.new_project(p_name TEXT) RETURNS UUID AS $$
DECLARE
  v_company UUID;
  v_person UUID;
  v_project UUID;
BEGIN
  INSERT INTO company (name) VALUES (p_name || ' Co') RETURNING company_id INTO v_company;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES (p_name, 'Person', lower(p_name) || '-pt@beeside-test.invalid', 'en', 'en', 'en') RETURNING person_id INTO v_person;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version)
    VALUES (v_company, v_person, v_person, current_setting('pt.qb'), current_setting('pt.re'), current_setting('pt.st'))
    RETURNING project_id INTO v_project;
  RETURN v_project;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'pt-admin@beeside.internal') RETURNING admin_user_id INTO v_id;
  PERFORM set_config('pt.admin', v_id::text, true);

  -- Minimal FA registry bootstrap so pg_temp.new_project() can pin the three existing FA registries
  -- (unrelated to Precision; required only because `project` has NOT NULL FKs to them) — via the
  -- real sanctioned config_* functions (0003/0004), same flow as run_versioning_tests.sql's own
  -- pg_temp.publish_flow helper; a direct INSERT with status='PUBLISHED' is rejected by that
  -- registry's own guard trigger, same discipline this suite enforces for Precision's own registries.
  PERFORM config_create_draft('QUESTION_BANK', 'pt-qb-1', current_setting('pt.qb_placeholder')::jsonb, current_setting('pt.admin')::uuid);
  PERFORM config_submit_for_preview('QUESTION_BANK', 'pt-qb-1', current_setting('pt.admin')::uuid);
  PERFORM config_record_review('QUESTION_BANK', 'pt-qb-1', current_setting('pt.admin')::uuid, 'APPROVED', true, 'suite fixture');
  PERFORM config_publish('QUESTION_BANK', 'pt-qb-1', current_setting('pt.admin')::uuid);
  PERFORM config_create_draft('RULES_ENGINE', 'pt-re-1', current_setting('pt.re_placeholder')::jsonb, current_setting('pt.admin')::uuid);
  PERFORM config_submit_for_preview('RULES_ENGINE', 'pt-re-1', current_setting('pt.admin')::uuid);
  PERFORM config_record_review('RULES_ENGINE', 'pt-re-1', current_setting('pt.admin')::uuid, 'APPROVED', true, 'suite fixture');
  PERFORM config_publish('RULES_ENGINE', 'pt-re-1', current_setting('pt.admin')::uuid);
  PERFORM config_create_draft('SNAPSHOT_TEMPLATE', 'pt-st-1', current_setting('pt.st_placeholder')::jsonb, current_setting('pt.admin')::uuid);
  PERFORM config_submit_for_preview('SNAPSHOT_TEMPLATE', 'pt-st-1', current_setting('pt.admin')::uuid);
  PERFORM config_record_review('SNAPSHOT_TEMPLATE', 'pt-st-1', current_setting('pt.admin')::uuid, 'APPROVED', true, 'suite fixture');
  PERFORM config_publish('SNAPSHOT_TEMPLATE', 'pt-st-1', current_setting('pt.admin')::uuid);
  PERFORM set_config('pt.qb', 'pt-qb-1', true);
  PERFORM set_config('pt.re', 'pt-re-1', true);
  PERFORM set_config('pt.st', 'pt-st-1', true);

  -- Precision fixture manifests: pilot content only (hygiene item C — never published as production
  -- regulatory truth in this suite either; publishing here happens only inside this disposable,
  -- always-rolled-back transaction, exactly like run_versioning_tests.sql's own publish_flow calls).
  INSERT INTO project_manifest_version (version, content, created_by_admin_user_id)
    VALUES ('pmv-pilot-1', '{"candidate_categories": [{"category_key": "logistics"}, {"category_key": "hr"}], "project_split_signals": []}'::jsonb, current_setting('pt.admin')::uuid);

  INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id)
    VALUES ('logistics', 'cmv-logistics-1', '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}'::jsonb, current_setting('pt.admin')::uuid);
  INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id)
    VALUES ('hr', 'cmv-hr-1', '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}'::jsonb, current_setting('pt.admin')::uuid);
  INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id)
    VALUES ('hr', 'cmv-hr-2', '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}'::jsonb, current_setting('pt.admin')::uuid);

  PERFORM precision_project_manifest_publish('pmv-pilot-1', current_setting('pt.admin')::uuid);
  PERFORM precision_category_manifest_publish('logistics', 'cmv-logistics-1', current_setting('pt.admin')::uuid);
  PERFORM precision_category_manifest_publish('hr', 'cmv-hr-1', current_setting('pt.admin')::uuid);

  RAISE NOTICE 'SETUP OK';
END $$;

\ir 10_instances_lifecycle.sql
\ir 20_fact_model.sql
\ir 30_manifest_versioning.sql
\ir 40_outputs_immutability.sql

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
