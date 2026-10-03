-- Included by run_precision_tests.sql. Assertions F01-F12: fact model — append-only, current-value
-- uniqueness, cross-project scoping, atomic fact_record() supersession, confidence discipline.

\echo '--- F01-F04: cross-project scoping guard + append-only basics ---'
DO $t$
DECLARE
  v_project UUID := current_setting('pt.project_alpha')::uuid;
  v_other_project UUID;
  v_cat_instance UUID := current_setting('pt.cat_alpha_logistics')::uuid;
BEGIN
  SELECT project_id INTO v_other_project FROM project WHERE project_id <> v_project LIMIT 1;

  PERFORM pg_temp.expect_error('F01',
    format($q$INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage)
              VALUES (%L, %L, 'precision.logistics.origin', '"x"'::jsonb, 'text', 'ANSWERED', 'category', 'client_answered')$q$,
      v_other_project, v_cat_instance),
    'BV409', 'cross-project scoping violation');

  INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage)
    VALUES (v_project, v_cat_instance, 'precision.logistics.origin', '"Guadalajara"'::jsonb, 'text', 'ANSWERED', 'category', 'client_answered');
  PERFORM pg_temp.assert_that('F02',
    EXISTS (SELECT 1 FROM fact WHERE scope_instance_id = v_cat_instance AND field_key = 'precision.logistics.origin' AND value = '"Guadalajara"'::jsonb),
    'the correctly-scoped fact row is accepted and readable back');

  PERFORM pg_temp.expect_error('F03',
    format($q$UPDATE fact SET value = '"Monterrey"'::jsonb WHERE scope_instance_id = %L AND field_key = 'precision.logistics.origin'$q$, v_cat_instance),
    'BV409', 'immutable except for superseded_by');

  PERFORM pg_temp.expect_error('F04',
    format($q$DELETE FROM fact WHERE scope_instance_id = %L AND field_key = 'precision.logistics.origin'$q$, v_cat_instance),
    'BV409', 'never deleted');
END $t$;

\echo '--- F05-F08: partial unique current-value index + fact_record() atomic supersession ---'
DO $t$
DECLARE
  v_cat_instance UUID := current_setting('pt.cat_alpha_logistics')::uuid;
  v_old_id UUID;
  v_new_id UUID;
BEGIN
  SELECT id INTO v_old_id FROM fact WHERE scope_instance_id = v_cat_instance AND field_key = 'precision.logistics.origin' AND superseded_by IS NULL;

  PERFORM pg_temp.expect_error('F05',
    format($q$INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage)
              VALUES (%L, %L, 'precision.logistics.origin', '"Puebla"'::jsonb, 'text', 'ANSWERED', 'category', 'client_corrected')$q$,
      current_setting('pt.project_alpha')::uuid, v_cat_instance),
    '23505', 'fact_current_value_idx');

  v_new_id := fact_record(current_setting('pt.project_alpha')::uuid, v_cat_instance, 'precision.logistics.origin',
    '"Puebla"'::jsonb, 'text', 'ANSWERED', 'category', 'client_corrected');
  PERFORM pg_temp.assert_that('F06',
    (SELECT superseded_by FROM fact WHERE id = v_old_id) = v_new_id,
    'fact_record() atomically supersedes the prior row from the same transaction-safe write path');
  PERFORM pg_temp.assert_that('F07',
    (SELECT value FROM fact WHERE scope_instance_id = v_cat_instance AND field_key = 'precision.logistics.origin' AND superseded_by IS NULL) = '"Puebla"'::jsonb,
    'the new row is now the current value');
  PERFORM pg_temp.assert_that('F08',
    (SELECT value FROM fact WHERE id = v_old_id) = '"Guadalajara"'::jsonb,
    'the superseded row keeps its original value — never rewritten, only pointed away from (§8/§9)');
END $t$;

\echo '--- F09-F12: confidence discipline + PA-level shared-fact scoping ---'
DO $t$
DECLARE
  v_project UUID := current_setting('pt.project_alpha')::uuid;
  v_pa_instance UUID := current_setting('pt.pa_alpha')::uuid;
BEGIN
  PERFORM pg_temp.expect_error('F09',
    format($q$INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage, confidence)
              VALUES (%L, %L, 'precision.pa.objective', '"expand"'::jsonb, 'text', 'ANSWERED', 'precision_assessment', 'client_confirmed', 0.8)$q$,
      v_project, v_pa_instance),
    '23514', 'fact_confidence_only_when_ai_extracted');

  PERFORM fact_record(v_project, v_pa_instance, 'precision.pa.objective', '"expand to Mexico"'::jsonb, 'text', 'ANSWERED', 'precision_assessment', 'ai_extracted', 0.42);
  PERFORM pg_temp.assert_that('F10',
    abs((SELECT confidence FROM fact WHERE scope_instance_id = v_pa_instance AND field_key = 'precision.pa.objective' AND superseded_by IS NULL) - 0.42) < 0.0001,
    'confidence is recorded for an ai_extracted fact (real-type storage, compared with float tolerance)');

  PERFORM fact_record(v_project, v_pa_instance, 'precision.pa.objective', '"expand to Mexico"'::jsonb, 'text', 'ANSWERED', 'precision_assessment', 'client_confirmed');
  PERFORM pg_temp.assert_that('F11',
    (SELECT confidence FROM fact WHERE scope_instance_id = v_pa_instance AND field_key = 'precision.pa.objective' AND superseded_by IS NULL) IS NULL,
    'a stale AI confidence number never outlives the clients own confirm act on the same field (§8)');

  PERFORM pg_temp.expect_error('F12',
    format($q$INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage, confidence)
              VALUES (%L, %L, 'precision.pa.other', '"x"'::jsonb, 'text', 'ANSWERED', 'precision_assessment', 'ai_extracted', 1.5)$q$,
      v_project, v_pa_instance),
    '23514', 'fact_confidence_range');
END $t$;
