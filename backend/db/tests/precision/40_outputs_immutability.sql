-- Included by run_precision_tests.sql. Assertions O01-O08: service_map_snapshot / pack full
-- immutability, service_map_snapshot scope guard, project.split_from_project_id.

\echo '--- O01-O04: service_map_snapshot and pack are fully immutable ---'
DO $t$
DECLARE
  v_pa_instance UUID := current_setting('pt.pa_alpha')::uuid;
  v_cat_instance UUID := current_setting('pt.cat_alpha_logistics')::uuid;
  v_snapshot_id UUID;
  v_pack_id UUID;
BEGIN
  SELECT id INTO v_snapshot_id FROM service_map_snapshot WHERE precision_instance_id = v_pa_instance AND version = 1;
  SELECT id INTO v_pack_id FROM pack WHERE category_assessment_instance_id = v_cat_instance AND version = 1;

  PERFORM pg_temp.expect_error('O01', format($q$UPDATE service_map_snapshot SET content = '{}'::jsonb WHERE id = %L$q$, v_snapshot_id), 'BV409', 'never updated or deleted');
  PERFORM pg_temp.expect_error('O02', format($q$DELETE FROM service_map_snapshot WHERE id = %L$q$, v_snapshot_id), 'BV409', 'never updated or deleted');
  PERFORM pg_temp.expect_error('O03', format($q$UPDATE pack SET content = '{}'::jsonb WHERE id = %L$q$, v_pack_id), 'BV409', 'never updated or deleted');
  PERFORM pg_temp.expect_error('O04', format($q$DELETE FROM pack WHERE id = %L$q$, v_pack_id), 'BV409', 'never updated or deleted');
END $t$;

\echo '--- O05: service_map_snapshot can only point at a scope=project instance ---'
DO $t$
DECLARE
  v_cat_instance UUID := current_setting('pt.cat_alpha_logistics')::uuid;
BEGIN
  PERFORM pg_temp.expect_error('O05',
    format($q$INSERT INTO service_map_snapshot (precision_instance_id, version, content) VALUES (%L, 99, '{}'::jsonb)$q$, v_cat_instance),
    'BV409', 'must reference a scope=project instance');
END $t$;

\echo '--- O06-O08: project.split_from_project_id — self-reference rejected, write-once ---'
DO $t$
DECLARE
  v_p1 UUID := pg_temp.new_project('SplitOriginal');
  v_p2 UUID := pg_temp.new_project('SplitOffspring');
  v_p3 UUID := pg_temp.new_project('SplitBystander');
BEGIN
  PERFORM pg_temp.expect_error('O06',
    format($q$UPDATE project SET split_from_project_id = %L WHERE project_id = %L$q$, v_p1, v_p1), '23514',
    'project_split_from_not_self');

  UPDATE project SET split_from_project_id = v_p1 WHERE project_id = v_p2;
  PERFORM pg_temp.assert_that('O07',
    (SELECT split_from_project_id FROM project WHERE project_id = v_p2) = v_p1,
    'P2.split_from_project_id = P1 — the worked example from §3A');

  PERFORM pg_temp.expect_error('O08',
    format($q$UPDATE project SET split_from_project_id = %L WHERE project_id = %L$q$, v_p3, v_p2), 'BV409',
    'split_from_project_id is write-once');
END $t$;
