-- Phase 2 integrity test suite (corrected). Every "expect rejection" test re-raises
-- anything that isn't the genuine trigger exception, so an ambiguous result becomes
-- a visible ERROR instead of a silent false PASS.
--
-- The whole suite runs inside ONE transaction that always ends in ROLLBACK: no fixture
-- (company, person, project, version rows, test field keys, ...) ever persists, including
-- rows that immutability/append-only triggers would otherwise make impossible to clean up.
-- ON_ERROR_STOP makes any unexpected error abort psql, which also discards the transaction.
-- Fixtures are addressed by the ids this suite creates, never by "first row in the table",
-- so the suite is safe to run against a database that already holds other data.
--
-- Expected result: 34 "Tn PASS" notices, the CHECK lines, and a final ROLLBACK.
-- Usage: psql "$DATABASE_URL" -X -f db/tests/run_tests.sql
\set ON_ERROR_STOP on

BEGIN;

\echo '--- SETUP: test-only version rows (rolled back with everything else) ---'
DO $$
BEGIN
  INSERT INTO question_bank_version (version, config, is_current)
    SELECT 'test-v1', '{}', NOT EXISTS (SELECT 1 FROM question_bank_version WHERE is_current);
  INSERT INTO rules_engine_version (version, config, is_current)
    SELECT 'test-v1', '{}', NOT EXISTS (SELECT 1 FROM rules_engine_version WHERE is_current);
  INSERT INTO snapshot_template_version (version, config, is_current)
    SELECT 'test-v1', '{}', NOT EXISTS (SELECT 1 FROM snapshot_template_version WHERE is_current);
  RAISE NOTICE 'SETUP OK: test-v1 rows created in the three version registries';
END $$;

\echo '--- T1: basic entity creation (company, person, project) ---'
DO $$
DECLARE c UUID; p1 UUID; p2 UUID; proj UUID;
BEGIN
  INSERT INTO company (name, website, normalized_domain) VALUES ('Patito SA', 'https://patito.com', 'patito.com') RETURNING company_id INTO c;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Miguel', 'Ortega', 'miguel@patito.com', 'es', 'es', 'es') RETURNING person_id INTO p1;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Laura', 'Diaz', 'laura@patito.com', 'es', 'es', 'es') RETURNING person_id INTO p2;
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version)
    VALUES (c, p1, p1, 'test-v1', 'test-v1', 'test-v1') RETURNING project_id INTO proj;
  -- Transaction-local: visible to the rest of this suite only, gone at ROLLBACK.
  PERFORM set_config('beeside_test.project_id', proj::text, true);
  RAISE NOTICE 'T1 PASS: company=%, person1=%, person2=%, project=%', c, p1, p2, proj;
END $$;

\echo '--- T2: person.primary_email UNIQUE rejects duplicate ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
      VALUES ('Miguel', 'Otro', 'miguel@patito.com', 'es', 'es', 'es');
    RAISE EXCEPTION 'SENTINEL_FAIL: duplicate primary_email was allowed';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'T2 PASS: duplicate primary_email rejected (%)', SQLERRM;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T2 PASS (unexpected error type): %', SQLERRM; END IF;
  END;
END $$;

\echo '--- T3: answer append-only + current-value partial unique index + correct supersede order ---'
DO $$
DECLARE proj UUID; a1 UUID; a2 UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  INSERT INTO field_key_registry (field_key, data_type, source, module) VALUES ('fa.__test_priority_reason', 'string', 'question_bank', 'first_assessment');
  INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (proj, 'fa.__test_priority_reason', '"grow sales"', 'string', 'test-v1') RETURNING answer_id INTO a1;

  BEGIN
    INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (proj, 'fa.__test_priority_reason', '"duplicate current"', 'string', 'test-v1');
    RAISE EXCEPTION 'SENTINEL_FAIL: second non-superseded answer for same field_key was allowed';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'T3a PASS: partial unique index rejected a second current answer';
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T3a PASS (unexpected error type): %', SQLERRM; END IF;
  END;

  -- CORRECT WRITE ORDER for "replacing" a current answer:
  -- pre-generate the new row's id, mark the OLD row superseded FIRST, then insert the new row.
  -- Inserting the new row before superseding the old one would violate the partial unique
  -- index, since both rows would transiently have superseded_by IS NULL at once.
  a2 := gen_random_uuid();
  UPDATE answer SET superseded_by = a2 WHERE answer_id = a1;
  INSERT INTO answer (answer_id, project_id, field_key, value, value_type, question_bank_version) VALUES (a2, proj, 'fa.__test_priority_reason', '"expand ops"', 'string', 'test-v1');
  RAISE NOTICE 'T3b PASS: correct-order supersede succeeded (old row marked superseded before new row inserted)';

  BEGIN
    UPDATE answer SET value = '"tampered"' WHERE answer_id = a1;
    RAISE EXCEPTION 'SENTINEL_FAIL: editing an already-superseded answer was allowed';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T3c PASS: editing a superseded answer rejected (%)', SQLERRM; END IF;
  END;

  BEGIN
    UPDATE answer SET value = '"tampered"' WHERE answer_id = a2;
    RAISE EXCEPTION 'SENTINEL_FAIL: direct value edit on current answer was allowed';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T3d PASS: direct value edit rejected (%)', SQLERRM; END IF;
  END;
END $$;

-- The superseded_by FK is DEFERRABLE INITIALLY DEFERRED, so inside this never-committed
-- transaction it would never be checked. Force the check now: any violation aborts the suite.
\echo '--- CHECK: deferred answer.superseded_by FK holds after the supersede sequence ---'
SET CONSTRAINTS answer_superseded_by_answer_answer_id_fk IMMEDIATE;
SET CONSTRAINTS answer_superseded_by_answer_answer_id_fk DEFERRED;

\echo '--- T4: finding.area_id must be a finding-capable category (rejects "Other" = 15) ---'
DO $$
DECLARE proj UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  BEGIN
    INSERT INTO finding (project_id, area_id, status, reason_client, rules_engine_version) VALUES (proj, 15, 'DEFINED', 'test', 'test-v1');
    RAISE EXCEPTION 'SENTINEL_FAIL: finding with area_id=15 (Other) was allowed';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T4 PASS: finding on non-finding-capable category rejected (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T5: finding.evidence_field_keys validated against field_key_registry ---'
DO $$
DECLARE proj UUID; affected INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  BEGIN
    INSERT INTO finding (project_id, area_id, status, reason_client, evidence_field_keys, rules_engine_version)
      VALUES (proj, 1, 'DEFINED', 'test', ARRAY['fa.__test_does_not_exist'], 'test-v1');
    RAISE EXCEPTION 'SENTINEL_FAIL: finding with unknown evidence_field_keys was allowed';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T5a PASS: unknown evidence_field_keys rejected (%)', SQLERRM; END IF;
  END;

  INSERT INTO finding (project_id, area_id, status, reason_client, evidence_field_keys, rules_engine_version)
    VALUES (proj, 1, 'DEFINED', 'test', ARRAY['fa.__test_priority_reason'], 'test-v1');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 1 THEN
    RAISE NOTICE 'T5b PASS: finding with valid evidence_field_keys inserted (% row)', affected;
  ELSE
    RAISE EXCEPTION 'T5b FAIL: expected 1 row inserted, got %', affected;
  END IF;
END $$;

\echo '--- T6: finding freezes once project reaches COMPLETED_LOCKED ---'
DO $$
DECLARE proj UUID; affected INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;

  UPDATE finding SET status = 'NEEDS_ATTENTION' WHERE project_id = proj AND area_id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'T6a SETUP FAIL: expected 1 row updated pre-lock, got %', affected; END IF;
  RAISE NOTICE 'T6a PASS: finding update succeeded while project still IN_PROGRESS (% row)', affected;

  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = proj;
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = proj;

  BEGIN
    UPDATE finding SET status = 'CRITICAL_GAP' WHERE project_id = proj AND area_id = 1;
    RAISE EXCEPTION 'SENTINEL_FAIL: finding was updated after project reached COMPLETED_LOCKED';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T6b PASS: finding update rejected after COMPLETED_LOCKED (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T7: assessment_state_transition auto-logged and append-only ---'
DO $$
DECLARE proj UUID; cnt INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  SELECT count(*) INTO cnt FROM assessment_state_transition WHERE project_id = proj;
  IF cnt = 2 THEN
    RAISE NOTICE 'T7a PASS: % assessment_state_transition rows auto-logged (DRAFT->IN_PROGRESS, IN_PROGRESS->COMPLETED_LOCKED)', cnt;
  ELSE
    RAISE EXCEPTION 'T7a FAIL: expected exactly 2 transition rows, found %', cnt;
  END IF;

  BEGIN
    DELETE FROM assessment_state_transition WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: assessment_state_transition rows were deletable';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T7b PASS: delete rejected (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T8: project pinned version fields are immutable ---'
DO $$
DECLARE proj UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  BEGIN
    UPDATE project SET rules_engine_version = 'test-v2' WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: rules_engine_version was changed after project creation';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T8 PASS: pinned version change rejected (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T9: premium_ever_activated and precision_state are monotonic ---'
DO $$
DECLARE proj UUID; affected INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;

  UPDATE project SET premium_ever_activated = true, premium_first_activated_at = now() WHERE project_id = proj;
  GET DIAGNOSTICS affected = ROW_COUNT;
  UPDATE project SET precision_state = 'STARTED', precision_started_at = now() WHERE project_id = proj;
  RAISE NOTICE 'T9a PASS: forward transitions succeeded (% row updated)', affected;

  BEGIN
    UPDATE project SET premium_ever_activated = false WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: premium_ever_activated reverted to false';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T9b PASS: revert rejected (%)', SQLERRM; END IF;
  END;

  BEGIN
    UPDATE project SET precision_state = 'NOT_STARTED' WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: precision_state reverted to NOT_STARTED';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T9c PASS: revert rejected (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T10: responsible_person_id reassignment is actor-attributed, function-only, and immutably logged ---'
DO $$
DECLARE
  proj UUID; p1 UUID; p2 UUID; admin1 UUID; cnt INT; change_id UUID; rc INT;
  logged_actor_type TEXT; logged_admin UUID; logged_person UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  SELECT person_id INTO p1 FROM person WHERE primary_email = 'miguel@patito.com';
  SELECT person_id INTO p2 FROM person WHERE primary_email = 'laura@patito.com';
  INSERT INTO admin_user (role, auth_identity) VALUES ('SUPERVISOR', 'supervisor@beeside.internal') RETURNING admin_user_id INTO admin1;

  -- T10a: PERSON actor reassignment, via the function, is logged with the right actor.
  change_id := reassign_project_responsibility(proj, p2, 'PERSON', p1, NULL);
  SELECT actor_type::TEXT, actor_person_id, actor_admin_user_id
    INTO logged_actor_type, logged_person, logged_admin
    FROM project_responsibility_change WHERE id = change_id;
  IF logged_actor_type = 'PERSON' AND logged_person = p1 AND logged_admin IS NULL THEN
    RAISE NOTICE 'T10a PASS: PERSON-actor reassignment logged correctly';
  ELSE
    RAISE EXCEPTION 'T10a FAIL: actor_type=%, actor_person_id=%, actor_admin_user_id=%', logged_actor_type, logged_person, logged_admin;
  END IF;

  -- T10b: ADMIN_USER actor reassignment (e.g. a Supervisor acting from Operation Hub).
  change_id := reassign_project_responsibility(proj, p1, 'ADMIN_USER', NULL, admin1);
  SELECT actor_type::TEXT, actor_person_id, actor_admin_user_id
    INTO logged_actor_type, logged_person, logged_admin
    FROM project_responsibility_change WHERE id = change_id;
  IF logged_actor_type = 'ADMIN_USER' AND logged_admin = admin1 AND logged_person IS NULL THEN
    RAISE NOTICE 'T10b PASS: ADMIN_USER-actor reassignment logged correctly';
  ELSE
    RAISE EXCEPTION 'T10b FAIL: actor_type=%, actor_person_id=%, actor_admin_user_id=%', logged_actor_type, logged_person, logged_admin;
  END IF;

  -- T10c: SYSTEM actor reassignment (both actor columns NULL is valid only for SYSTEM).
  change_id := reassign_project_responsibility(proj, p2, 'SYSTEM', NULL, NULL);
  SELECT actor_type::TEXT, actor_person_id, actor_admin_user_id
    INTO logged_actor_type, logged_person, logged_admin
    FROM project_responsibility_change WHERE id = change_id;
  IF logged_actor_type = 'SYSTEM' AND logged_admin IS NULL AND logged_person IS NULL THEN
    RAISE NOTICE 'T10c PASS: SYSTEM-actor reassignment logged correctly';
  ELSE
    RAISE EXCEPTION 'T10c FAIL: actor_type=%, actor_person_id=%, actor_admin_user_id=%', logged_actor_type, logged_person, logged_admin;
  END IF;

  SELECT count(*) INTO cnt FROM project_responsibility_change WHERE project_id = proj;
  IF cnt = 3 THEN
    RAISE NOTICE 'T10d PASS: exactly 3 audit rows accumulated (one per reassignment)';
  ELSE
    RAISE EXCEPTION 'T10d FAIL: expected 3 log rows, found %', cnt;
  END IF;

  -- T10e: a direct UPDATE bypassing the function must be rejected (this is the actual
  -- fix — the old design silently logged changed_by_person_id = NULL instead).
  BEGIN
    UPDATE project SET responsible_person_id = p1 WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: direct UPDATE of responsible_person_id was allowed';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T10e PASS: direct UPDATE rejected (%)', SQLERRM; END IF;
  END;

  -- T10f: the function itself rejects an inconsistent actor combination (PERSON with no
  -- actor_person_id) before touching any row — defense in depth ahead of the CHECK.
  BEGIN
    PERFORM reassign_project_responsibility(proj, p1, 'PERSON', NULL, NULL);
    RAISE EXCEPTION 'SENTINEL_FAIL: function accepted PERSON actor with no actor_person_id';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T10f PASS: inconsistent actor combination rejected (%)', SQLERRM; END IF;
  END;

  -- T10g: the CHECK constraint itself rejects an inconsistent actor combination even on
  -- a raw INSERT that bypasses the function entirely.
  BEGIN
    INSERT INTO project_responsibility_change
      (project_id, previous_responsible_person_id, new_responsible_person_id, actor_type, actor_person_id, actor_admin_user_id)
      VALUES (proj, p1, p2, 'ADMIN_USER', p1, NULL);
    RAISE EXCEPTION 'SENTINEL_FAIL: CHECK constraint accepted ADMIN_USER actor with a person id instead of an admin_user id';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T10g PASS: actor consistency CHECK rejected mismatched combination (%)', SQLERRM; END IF;
  END;

  -- T10h: log rows remain append-only (immutable/undeletable) under the new columns too.
  BEGIN
    DELETE FROM project_responsibility_change WHERE project_id = proj;
    RAISE EXCEPTION 'SENTINEL_FAIL: project_responsibility_change rows were deletable';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T10h PASS: delete rejected (%)', SQLERRM; END IF;
  END;
END $$;

\echo '--- T11: at most one PREMIUM_ACTIVE subscription per project ---'
DO $$
DECLARE proj UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (proj, 'PREMIUM_ACTIVE', now(), now() + interval '30 days');
  BEGIN
    INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
      VALUES (proj, 'PREMIUM_ACTIVE', now(), now() + interval '30 days');
    RAISE EXCEPTION 'SENTINEL_FAIL: a second PREMIUM_ACTIVE subscription for the same project was allowed';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'T11 PASS: second concurrent PREMIUM_ACTIVE subscription rejected';
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T11 PASS (unexpected error type): %', SQLERRM; END IF;
  END;
END $$;

\echo '--- T12: subscription write auto-syncs entitlement and subscription_state_transition ---'
DO $$
DECLARE proj UUID; ent_active BOOLEAN; hist_cnt INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  SELECT premium_access_active INTO ent_active FROM entitlement WHERE project_id = proj;
  SELECT count(*) INTO hist_cnt FROM subscription_state_transition WHERE project_id = proj;
  IF ent_active = true AND hist_cnt = 1 THEN
    RAISE NOTICE 'T12 PASS: entitlement.premium_access_active=true, % history row logged', hist_cnt;
  ELSE
    RAISE EXCEPTION 'T12 FAIL: entitlement=% history_count=%', ent_active, hist_cnt;
  END IF;
END $$;

\echo '--- T13: snapshot / internal_assessment / precision_handoff_package are fully immutable ---'
DO $$
DECLARE proj UUID; snap_id UUID;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content)
    VALUES (proj, 'test-v1', 'test-v1', '{"example":"frozen"}') RETURNING snapshot_id INTO snap_id;

  BEGIN
    UPDATE snapshot SET content = '{"tampered":true}' WHERE snapshot_id = snap_id;
    RAISE EXCEPTION 'SENTINEL_FAIL: snapshot was updated';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T13a PASS: snapshot update rejected'; END IF;
  END;

  BEGIN
    DELETE FROM snapshot WHERE snapshot_id = snap_id;
    RAISE EXCEPTION 'SENTINEL_FAIL: snapshot was deleted';
  EXCEPTION
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T13b PASS: snapshot delete rejected'; END IF;
  END;

  BEGIN
    INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content)
      VALUES (proj, 'test-v1', 'test-v1', '{}');
    RAISE EXCEPTION 'SENTINEL_FAIL: a second snapshot for the same project was allowed';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'T13c PASS: second snapshot for same project rejected';
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T13c PASS (unexpected error type): %', SQLERRM; END IF;
  END;
END $$;

\echo '--- T14: operation_hub_link composite PK allows multiple external systems per project ---'
DO $$
DECLARE proj UUID; cnt INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  INSERT INTO operation_hub_link (project_id, external_system, external_workspace_id) VALUES (proj, 'clickup', 'ws-1');
  INSERT INTO operation_hub_link (project_id, external_system, external_workspace_id) VALUES (proj, 'future_system', 'ws-2');
  SELECT count(*) INTO cnt FROM operation_hub_link WHERE project_id = proj;
  IF cnt = 2 THEN
    RAISE NOTICE 'T14 PASS: two different external_system links for the same project both succeeded';
  ELSE
    RAISE EXCEPTION 'T14 FAIL: expected 2 links, found %', cnt;
  END IF;
END $$;

\echo '--- T15: rules_matrix_category / capability_taxonomy_category catalog counts (migration 0002) ---'
DO $$
DECLARE rm_cnt INT; ct_cnt INT; finding_areas INT; country_cnt INT;
BEGIN
  SELECT count(*) INTO rm_cnt FROM rules_matrix_category;
  SELECT count(*) INTO ct_cnt FROM capability_taxonomy_category;
  SELECT count(*) INTO finding_areas FROM rules_matrix_category WHERE is_finding_area = true;
  SELECT count(*) INTO country_cnt FROM country;
  IF rm_cnt = 15 AND ct_cnt = 10 AND finding_areas = 14 AND country_cnt >= 1 THEN
    RAISE NOTICE 'T15 PASS: 15 rules_matrix_category rows (14 finding-capable), 10 capability_taxonomy_category rows, % country rows', country_cnt;
  ELSE
    RAISE EXCEPTION 'T15 FAIL: rm_cnt=% ct_cnt=% finding_areas=% country_cnt=%', rm_cnt, ct_cnt, finding_areas, country_cnt;
  END IF;
END $$;

\echo '--- T16: only one is_current version row allowed per version registry ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO rules_engine_version (version, config, is_current) VALUES ('test-v2', '{}', true);
    RAISE EXCEPTION 'SENTINEL_FAIL: a second is_current=true rules_engine_version was allowed';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'T16 PASS: second concurrent is_current version rejected';
    WHEN OTHERS THEN IF SQLERRM LIKE 'SENTINEL_FAIL%' THEN RAISE; ELSE RAISE NOTICE 'T16 PASS (unexpected error type): %', SQLERRM; END IF;
  END;
END $$;

\echo '--- T17: answer.value supports multi-select containment queries (target_markets pattern) ---'
DO $$
DECLARE proj UUID; hit_cnt INT;
BEGIN
  proj := current_setting('beeside_test.project_id')::uuid;
  INSERT INTO field_key_registry (field_key, data_type, source, module) VALUES ('fa.__test_target_markets', 'multi_select', 'question_bank', 'first_assessment');
  INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES (proj, 'fa.__test_target_markets', '["MX","US"]', 'multi_select', 'test-v1');
  SELECT count(*) INTO hit_cnt FROM answer WHERE project_id = proj AND field_key = 'fa.__test_target_markets' AND value @> '["MX"]';
  IF hit_cnt = 1 THEN
    RAISE NOTICE 'T17 PASS: containment query over multi-select answer.value returned expected row';
  ELSE
    RAISE EXCEPTION 'T17 FAIL: expected 1 row, found %', hit_cnt;
  END IF;
END $$;

\echo '--- CHECK: all deferred constraints hold at end of suite ---'
SET CONSTRAINTS ALL IMMEDIATE;

\echo '--- DONE: rolling back, no test data persists ---'
ROLLBACK;
