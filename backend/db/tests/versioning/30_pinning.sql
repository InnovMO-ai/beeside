-- Included by run_versioning_tests.sql (inside its transaction). Assertions P01–P09.
-- State on entry: current question bank vt-qb-2 (after rollback), current rules engine vt-re-1
-- (vt-re-2 in PREVIEW), no snapshot template published by this suite yet.

\echo '--- P01-P04: assessment_started pins the current PUBLISHED versions ---'
DO $t$
DECLARE
  v_a UUID;
  v_d UUID;
  v_p project%ROWTYPE;
BEGIN
  PERFORM pg_temp.expect_error('P01', $q$SELECT pg_temp.start_project_without_current_template()$q$, 'BV412',
    'every registry needs a current PUBLISHED version');
  PERFORM pg_temp.publish_flow('SNAPSHOT_TEMPLATE', 'vt-st-1', pg_temp.bundle('st1'));

  v_a := pg_temp.new_project();
  PERFORM set_config('vt.project_a', v_a::text, true);
  SELECT * INTO v_p FROM project WHERE project_id = v_a;
  PERFORM pg_temp.assert_that('P02',
    v_p.question_bank_version = 'vt-qb-2' AND v_p.rules_engine_version = 'vt-re-1' AND v_p.snapshot_template_version = 'vt-st-1',
    'a project started without explicit versions pins the three current PUBLISHED versions');
  PERFORM pg_temp.expect_error('P03', $q$SELECT pg_temp.new_project('vt-qb-3', NULL, NULL)$q$, 'BV412',
    'must pin the current question_bank_version');
  v_d := pg_temp.new_project('vt-qb-2', 'vt-re-1', 'vt-st-1');
  PERFORM pg_temp.assert_that('P04',
    (SELECT question_bank_version || '/' || rules_engine_version || '/' || snapshot_template_version FROM project WHERE project_id = v_d)
      = 'vt-qb-2/vt-re-1/vt-st-1',
    'explicit version values are accepted only when they are exactly the current versions');
END $t$;

\echo '--- P05-P07: later publishes and rollbacks never touch started projects ---'
DO $t$
DECLARE
  v_a UUID := current_setting('vt.project_a')::uuid;
  v_b UUID;
  v_c UUID;
BEGIN
  PERFORM config_record_review('RULES_ENGINE', 'vt-re-2', pg_temp.actor('reviewer'), 'APPROVED', true, 'diff reviewed');
  PERFORM config_publish('RULES_ENGINE', 'vt-re-2', pg_temp.actor('admin'));
  v_b := pg_temp.new_project();
  PERFORM pg_temp.assert_that('P05',
    (SELECT rules_engine_version FROM project WHERE project_id = v_a) = 'vt-re-1'
    AND (SELECT rules_engine_version FROM project WHERE project_id = v_b) = 'vt-re-2',
    'publishing a rules change mid-assessment leaves the in-flight project on vt-re-1; the next project pins vt-re-2');

  PERFORM config_set_current('RULES_ENGINE', 'vt-re-1', pg_temp.actor('admin'), 'rollback of vt-re-2');
  -- Start the project in its own statement: a volatile INSERT function inside a query's WHERE
  -- runs per scanned row and its rows are invisible to that same query's snapshot.
  v_c := pg_temp.new_project();
  PERFORM pg_temp.assert_that('P06',
    (SELECT rules_engine_version FROM project WHERE project_id = v_b) = 'vt-re-2'
    AND (SELECT rules_engine_version FROM project WHERE project_id = v_c) = 'vt-re-1',
    'a rollback repoint affects only future projects: the vt-re-2 project is unchanged, the next one pins vt-re-1');

  PERFORM pg_temp.expect_error('P07',
    format($q$UPDATE project SET rules_engine_version = 'vt-re-2' WHERE project_id = %L$q$, v_a), 'P0001',
    'pinned version fields are immutable');
END $t$;

\echo '--- P08a-P09: frozen snapshot re-verified through the publish pathway; pinned bundles reconstructable ---'
DO $t$
DECLARE
  v_a UUID := current_setting('vt.project_a')::uuid;
  v_snapshot snapshot%ROWTYPE;
  v_after snapshot%ROWTYPE;
BEGIN
  UPDATE project SET assessment_state = 'IN_PROGRESS' WHERE project_id = v_a;
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v_a;
  INSERT INTO snapshot (project_id, rules_engine_version, snapshot_template_version, content)
    SELECT project_id, rules_engine_version, snapshot_template_version, jsonb_build_object('greeting', 'Hi Suite')
    FROM project WHERE project_id = v_a
    RETURNING * INTO v_snapshot;

  PERFORM pg_temp.publish_flow('SNAPSHOT_TEMPLATE', 'vt-st-2', pg_temp.bundle('st2'));
  SELECT * INTO v_after FROM snapshot WHERE snapshot_id = v_snapshot.snapshot_id;

  PERFORM pg_temp.expect_error('P08a',
    format($q$UPDATE snapshot SET snapshot_template_version = 'vt-st-2' WHERE snapshot_id = %L$q$, v_snapshot.snapshot_id),
    'P0001', 'immutable');
  PERFORM pg_temp.assert_that('P08b',
    v_after.content = v_snapshot.content AND v_after.snapshot_template_version = 'vt-st-1'
    AND (SELECT snapshot_template_version FROM project WHERE project_id = v_a) = 'vt-st-1'
    AND pg_temp.current_version('SNAPSHOT_TEMPLATE') = 'vt-st-2'
    AND pg_temp.version_row('SNAPSHOT_TEMPLATE', 'vt-st-2') ->> 'change_kind' = 'CONTENT',
    'publishing a new snapshot template leaves the locked project and its frozen snapshot on vt-st-1');

  PERFORM pg_temp.assert_that('P09',
    EXISTS (
      SELECT 1 FROM project AS p
      JOIN question_bank_version AS q ON q.version = p.question_bank_version
      JOIN rules_engine_version AS r ON r.version = p.rules_engine_version
      JOIN snapshot_template_version AS s ON s.version = p.snapshot_template_version
      WHERE p.project_id = v_a
        AND q.status = 'PUBLISHED' AND r.status = 'PUBLISHED' AND s.status = 'PUBLISHED'
        AND q.content_hash = config_content_hash(q.config)
        AND r.content_hash = config_content_hash(r.config)
        AND s.content_hash = config_content_hash(s.config)),
    'the exact bundles pinned by a project stay PUBLISHED and hash-identical, so its results remain reconstructable');
END $t$;
