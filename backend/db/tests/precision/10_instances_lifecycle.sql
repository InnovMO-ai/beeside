-- Included by run_precision_tests.sql. Assertions I01-I18: precision_instance / precision_assessment
-- / category_assessment identity, scoping and lifecycle integrity.

\echo '--- I01-I04: one Precision Assessment per project (base-table partial unique index) ---'
DO $t$
DECLARE
  v_project UUID := pg_temp.new_project('Alpha');
  v_pa1 UUID;
BEGIN
  PERFORM set_config('pt.project_alpha', v_project::text, true);
  INSERT INTO precision_instance (project_id, scope) VALUES (v_project, 'project') RETURNING id INTO v_pa1;
  PERFORM set_config('pt.pa_alpha', v_pa1::text, true);
  INSERT INTO precision_assessment (instance_id, manifest_version)
    VALUES (v_pa1, (SELECT version FROM project_manifest_version WHERE is_current));
  PERFORM pg_temp.assert_that('I01', (SELECT lifecycle_status FROM precision_assessment WHERE instance_id = v_pa1) = 'not_started',
    'a new precision_assessment starts not_started');

  PERFORM pg_temp.expect_error('I02',
    format($q$INSERT INTO precision_instance (project_id, scope) VALUES (%L, 'project')$q$, v_project), '23505',
    'precision_instance_one_pa_per_project');

  -- A second, independent project may of course have its own PA (the constraint is per-project, not global).
  DECLARE v_other UUID := pg_temp.new_project('Beta'); v_pa2 UUID;
  BEGIN
    INSERT INTO precision_instance (project_id, scope) VALUES (v_other, 'project') RETURNING id INTO v_pa2;
    PERFORM pg_temp.assert_that('I03', v_pa2 IS NOT NULL, 'a different project may have its own PA instance');
  END;

  PERFORM pg_temp.expect_error('I04', format($q$UPDATE precision_instance SET scope = 'category' WHERE id = %L$q$, v_pa1), 'BV409', 'immutable');
END $t$;

\echo '--- I05-I10: precision_assessment lifecycle state machine + confirmed_at auto-maintenance ---'
DO $t$
DECLARE
  v_pa UUID := current_setting('pt.pa_alpha')::uuid;
BEGIN
  PERFORM pg_temp.expect_error('I05',
    format($q$UPDATE precision_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = %L$q$, v_pa), 'BV409',
    'cannot move from');

  UPDATE precision_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = v_pa;
  UPDATE precision_assessment SET lifecycle_status = 'ready_for_confirmation' WHERE instance_id = v_pa;
  PERFORM pg_temp.assert_that('I06', (SELECT confirmed_at FROM precision_assessment WHERE instance_id = v_pa) IS NULL,
    'confirmed_at stays NULL until the PA is actually confirmed');

  PERFORM pg_temp.expect_error('I07',
    format($q$UPDATE precision_assessment SET service_map_snapshot_id = gen_random_uuid() WHERE instance_id = %L$q$, v_pa), 'BV409',
    'service_map_snapshot_id is written only by precision_assessment_confirm()');

  PERFORM precision_assessment_confirm(v_pa, '{"categories": []}'::jsonb);
  PERFORM pg_temp.assert_that('I08',
    (SELECT lifecycle_status = 'confirmed' AND confirmed_at IS NOT NULL AND service_map_snapshot_id IS NOT NULL FROM precision_assessment WHERE instance_id = v_pa),
    'precision_assessment_confirm() atomically inserts the snapshot, sets the pointer, confirms, and stamps confirmed_at');
  PERFORM pg_temp.assert_that('I09',
    (SELECT version FROM service_map_snapshot WHERE precision_instance_id = v_pa) = 1,
    'the first confirmation produces service_map_snapshot version 1');

  -- Reopen (client-initiated), then reconfirm: a NEW snapshot version, confirmed_at moves forward.
  DECLARE v_first_confirmed_at TIMESTAMPTZ := (SELECT confirmed_at FROM precision_assessment WHERE instance_id = v_pa);
  BEGIN
    UPDATE precision_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = v_pa;
    PERFORM pg_temp.expect_error('I10a', format($q$SELECT precision_assessment_confirm(%L, '{}'::jsonb)$q$, v_pa), 'BV409',
      'must be ready_for_confirmation to confirm');
    UPDATE precision_assessment SET lifecycle_status = 'ready_for_confirmation' WHERE instance_id = v_pa;
    PERFORM pg_sleep(0.01);
    PERFORM precision_assessment_confirm(v_pa, '{"categories": ["logistics"]}'::jsonb);
    PERFORM pg_temp.assert_that('I10b',
      (SELECT version FROM service_map_snapshot WHERE precision_instance_id = v_pa AND version = 2) IS NOT NULL
      AND (SELECT confirmed_at FROM precision_assessment WHERE instance_id = v_pa) > v_first_confirmed_at,
      'reconfirmation produces snapshot version 2 and advances confirmed_at; the original snapshot is untouched (immutability proven in 40_*)');
  END;
END $t$;

\echo '--- I11-I18: category_assessment identity, project-leak guard, uniqueness, lifecycle, current_pack_id ---'
DO $t$
DECLARE
  v_project UUID := current_setting('pt.project_alpha')::uuid;
  v_other_project UUID;
  v_cat_instance UUID;
BEGIN
  INSERT INTO precision_instance (project_id, scope) VALUES (v_project, 'category') RETURNING id INTO v_cat_instance;
  PERFORM set_config('pt.cat_alpha_logistics', v_cat_instance::text, true);

  SELECT project_id INTO v_other_project FROM project WHERE project_id <> v_project LIMIT 1;
  PERFORM pg_temp.expect_error('I11',
    format($q$INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
              VALUES (%L, %L, 'logistics', 'cmv-logistics-1', 'pa_detected')$q$, v_cat_instance, v_other_project),
    'BV409', 'cross-project scoping violation');

  INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
    VALUES (v_cat_instance, v_project, 'logistics', 'cmv-logistics-1', 'pa_detected');
  PERFORM pg_temp.assert_that('I12',
    (SELECT lifecycle_status FROM category_assessment WHERE instance_id = v_cat_instance) = 'proposed',
    'a new category_assessment starts proposed');

  -- Duplicate (project_id, category_key) rejected (§6/§33 item 8, frozen permanent v1 rule).
  DECLARE v_dup_instance UUID;
  BEGIN
    INSERT INTO precision_instance (project_id, scope) VALUES (v_project, 'category') RETURNING id INTO v_dup_instance;
    PERFORM pg_temp.expect_error('I13',
      format($q$INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
                VALUES (%L, %L, 'logistics', 'cmv-logistics-1', 'client_added')$q$, v_dup_instance, v_project),
      '23505', 'category_assessment_project_category_unique');
  END;

  -- Composite FK rejects a manifest_version pinned under a different category_key.
  DECLARE v_mismatch_instance UUID;
  BEGIN
    INSERT INTO precision_instance (project_id, scope) VALUES (v_project, 'category') RETURNING id INTO v_mismatch_instance;
    PERFORM pg_temp.expect_error('I14',
      format($q$INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
                VALUES (%L, %L, 'hr', 'cmv-logistics-1', 'pa_detected')$q$, v_mismatch_instance, v_project),
      '23503', 'category_assessment_manifest_version_fk');
  END;

  PERFORM pg_temp.expect_error('I15',
    format($q$UPDATE category_assessment SET lifecycle_status = 'completed' WHERE instance_id = %L$q$, v_cat_instance), 'BV409',
    'cannot move from');

  UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = v_cat_instance;
  PERFORM pg_temp.expect_error('I16a',
    format($q$SELECT category_assessment_complete(%L, '{}'::jsonb, '{}'::jsonb)$q$, v_cat_instance), 'BV409',
    'must be in_progress to complete');
  UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = v_cat_instance;

  PERFORM pg_temp.expect_error('I16',
    format($q$UPDATE category_assessment SET current_pack_id = gen_random_uuid() WHERE instance_id = %L$q$, v_cat_instance), 'BV409',
    'current_pack_id is written only by category_assessment_complete()');
END $t$;

DO $t$
DECLARE
  v_cat_instance UUID := current_setting('pt.cat_alpha_logistics')::uuid;
  v_pack_id UUID;
BEGIN
  v_pack_id := category_assessment_complete(v_cat_instance, '{"fields": {}}'::jsonb, '{"category_manifest_version": "cmv-logistics-1"}'::jsonb);
  PERFORM pg_temp.assert_that('I17',
    (SELECT lifecycle_status = 'completed' AND current_pack_id = v_pack_id FROM category_assessment WHERE instance_id = v_cat_instance),
    'category_assessment_complete() atomically inserts the pack and repoints current_pack_id');

  UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = v_cat_instance;
  DECLARE v_pack_id_2 UUID := category_assessment_complete(v_cat_instance, '{"fields": {"a": 1}}'::jsonb, '{"category_manifest_version": "cmv-logistics-1"}'::jsonb);
  BEGIN
    PERFORM pg_temp.assert_that('I18',
      (SELECT version FROM pack WHERE id = v_pack_id_2) = 2 AND (SELECT current_pack_id FROM category_assessment WHERE instance_id = v_cat_instance) = v_pack_id_2,
      'recompletion (reopen) produces pack version 2 and repoints current_pack_id to it; version 1 remains, untouched, as history');
  END;
END $t$;
