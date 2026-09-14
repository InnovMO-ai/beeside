-- Included by run_versioning_tests.sql (inside its transaction). Assertions L01–L26e.

\echo '--- L01-L04: only active ADMIN actors, only through the config_* functions ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('L01', $q$SELECT config_create_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb1_draft'), pg_temp.actor('supervisor'))$q$, 'BV403');
  PERFORM pg_temp.expect_error('L02', $q$SELECT config_create_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb1_draft'), pg_temp.actor('inactive'))$q$, 'BV403');
  PERFORM pg_temp.expect_error('L03', $q$SELECT config_create_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb1_draft'), NULL)$q$, 'BV403');
  PERFORM pg_temp.expect_error('L04', $q$INSERT INTO question_bank_version (version, config, created_by_admin_user_id) VALUES ('vt-direct', '{}', pg_temp.actor('admin'))$q$, 'BV403');
END $t$;

\echo '--- L05-L11: Draft creation, editing, and what a Draft cannot do ---'
DO $t$
DECLARE v_row JSONB;
BEGIN
  PERFORM config_create_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb1_draft'), pg_temp.actor('admin'));
  v_row := pg_temp.version_row('QUESTION_BANK', 'vt-qb-1');
  PERFORM pg_temp.assert_that('L05',
    v_row ->> 'status' = 'DRAFT' AND (v_row ->> 'is_current')::boolean = false
    AND v_row ->> 'created_by_admin_user_id' = current_setting('vt.actor_admin')
    AND EXISTS (SELECT 1 FROM config_version_event WHERE question_bank_version = 'vt-qb-1' AND event_type = 'DRAFT_CREATED'),
    'draft created as non-current DRAFT by the ADMIN, with a DRAFT_CREATED audit event');
  PERFORM pg_temp.expect_error('L06', $q$SELECT config_create_draft('QUESTION_BANK', 'vt-qb-1', '{}', pg_temp.actor('admin'))$q$, '23505');
  PERFORM pg_temp.expect_error('L07', $q$SELECT config_create_draft('QUESTION_BANK', 'bad version!', '{}', pg_temp.actor('admin'))$q$, 'BV422');

  PERFORM config_update_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb1'), pg_temp.actor('admin'));
  PERFORM pg_temp.assert_that('L08',
    pg_temp.version_row('QUESTION_BANK', 'vt-qb-1') -> 'config' = pg_temp.bundle('qb1')
    AND EXISTS (SELECT 1 FROM config_version_event WHERE question_bank_version = 'vt-qb-1' AND event_type = 'DRAFT_UPDATED'),
    'draft edited through config_update_draft and audited');
  PERFORM pg_temp.expect_error('L09', $q$UPDATE question_bank_version SET config = '{}' WHERE version = 'vt-qb-1'$q$, 'BV403');
  PERFORM pg_temp.expect_error('L10', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'))$q$, 'BV409', 'DRAFT');
  PERFORM pg_temp.expect_error('L11', $q$SELECT config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'), 'APPROVED', true, NULL)$q$, 'BV409');
END $t$;

\echo '--- L12-L15: bundle validation at Draft -> Preview ---'
DO $t$
BEGIN
  PERFORM config_create_draft('QUESTION_BANK', 'vt-qb-bad', pg_temp.bundle('bad_locale'), pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L12', $q$SELECT config_submit_for_preview('QUESTION_BANK', 'vt-qb-bad', pg_temp.actor('admin'))$q$, 'BV422', 'locale es');
  PERFORM config_update_draft('QUESTION_BANK', 'vt-qb-bad', pg_temp.bundle('bad_variable'), pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L13', $q$SELECT config_submit_for_preview('QUESTION_BANK', 'vt-qb-bad', pg_temp.actor('admin'))$q$, 'BV422', 'undeclared template variables: preferred_name');
  PERFORM config_update_draft('QUESTION_BANK', 'vt-qb-bad', pg_temp.bundle('bad_field_key'), pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L14', $q$SELECT config_submit_for_preview('QUESTION_BANK', 'vt-qb-bad', pg_temp.actor('admin'))$q$, 'BV422', 'not an active first_assessment key');
  PERFORM config_update_draft('QUESTION_BANK', 'vt-qb-bad', pg_temp.bundle('bad_schema_version'), pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L15', $q$SELECT config_submit_for_preview('QUESTION_BANK', 'vt-qb-bad', pg_temp.actor('admin'))$q$, 'BV422', 'schema_version');
END $t$;

\echo '--- L16-L25: Preview freezes, publication gates, first publish ---'
DO $t$
DECLARE
  v_row JSONB;
  v_preview JSONB;
  v_review config_version_review%ROWTYPE;
  v_publish JSONB;
BEGIN
  v_preview := config_submit_for_preview('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'));
  v_row := pg_temp.version_row('QUESTION_BANK', 'vt-qb-1');
  PERFORM pg_temp.assert_that('L16',
    v_row ->> 'status' = 'PREVIEW' AND v_row ->> 'change_kind' = 'LOGIC_SCHEMA'
    AND (v_row ->> 'base_version') IS NOT DISTINCT FROM NULLIF(current_setting('vt.initial_qb'), '')
    AND v_row ->> 'content_hash' = encode(sha256(convert_to(pg_temp.bundle('qb1')::text, 'UTF8')), 'hex')
    AND v_preview ->> 'change_kind' = 'LOGIC_SCHEMA' AND jsonb_array_length(v_preview -> 'diff') > 0,
    'valid bundle frozen in PREVIEW, classified LOGIC_SCHEMA, content hash = sha256(bundle), diff returned');

  PERFORM pg_temp.expect_error('L17', $q$SELECT config_update_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb2'), pg_temp.actor('admin'))$q$, 'BV409');
  PERFORM pg_temp.expect_error('L18', $q$UPDATE question_bank_version SET config = '{"tampered": true}' WHERE version = 'vt-qb-1'$q$, 'BV409', 'frozen in PREVIEW', true);
  PERFORM pg_temp.expect_error('L19', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'))$q$, 'BV412', 'no review recorded');
  PERFORM pg_temp.expect_error('L20', $q$SELECT config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('reviewer'), 'APPROVED', false, 'looks fine')$q$, 'BV412', 'diff review');
  PERFORM pg_temp.expect_error('L21', $q$SELECT config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('reviewer'), 'REJECTED', false, '  ')$q$, 'BV422');

  PERFORM config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('reviewer'), 'REJECTED', true, 'option list incomplete');
  PERFORM pg_temp.expect_error('L22', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'))$q$, 'BV412', 'rejected');
  PERFORM pg_temp.expect_error('L23', $q$SELECT config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('supervisor'), 'APPROVED', true, NULL)$q$, 'BV403');

  PERFORM config_record_review('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('reviewer'), 'APPROVED', true, 'diff reviewed');
  SELECT * INTO v_review FROM config_version_review
   WHERE question_bank_version = 'vt-qb-1' ORDER BY reviewed_at DESC, review_id DESC LIMIT 1;
  PERFORM pg_temp.assert_that('L24',
    v_review.decision = 'APPROVED' AND v_review.diff_reviewed AND v_review.change_kind = 'LOGIC_SCHEMA'
    AND v_review.content_hash = v_row ->> 'content_hash' AND jsonb_array_length(v_review.diff) > 0
    AND v_review.reviewer_admin_user_id = pg_temp.actor('reviewer'),
    'approval recorded with the reviewed diff, bound to the frozen content hash and reviewer');

  v_publish := config_publish('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'));
  v_row := pg_temp.version_row('QUESTION_BANK', 'vt-qb-1');
  PERFORM pg_temp.assert_that('L25',
    v_row ->> 'status' = 'PUBLISHED' AND (v_row ->> 'is_current')::boolean
    AND v_row ->> 'published_by_admin_user_id' = current_setting('vt.actor_admin')
    AND pg_temp.current_version('QUESTION_BANK') = 'vt-qb-1'
    AND (v_publish ->> 'review_id')::uuid = v_review.review_id
    AND EXISTS (SELECT 1 FROM config_version_event WHERE question_bank_version = 'vt-qb-1' AND event_type = 'PUBLISHED'
                AND details ->> 'review_id' = v_review.review_id::text),
    'publish succeeded only after an approved diff review; version is PUBLISHED and the unique current version');
END $t$;

\echo '--- L26a-L26e: a PUBLISHED version cannot be modified silently ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('L26a', $q$UPDATE question_bank_version SET config = '{"tampered": true}' WHERE version = 'vt-qb-1'$q$, 'BV409', 'immutable', true);
  PERFORM pg_temp.expect_error('L26b', $q$UPDATE question_bank_version SET status = 'DRAFT' WHERE version = 'vt-qb-1'$q$, 'BV409', 'immutable', true);
  PERFORM pg_temp.expect_error('L26c', $q$DELETE FROM question_bank_version WHERE version = 'vt-qb-1'$q$, 'BV409', 'never deleted', true);
  PERFORM pg_temp.expect_error('L26d', $q$SELECT config_update_draft('QUESTION_BANK', 'vt-qb-1', pg_temp.bundle('qb2'), pg_temp.actor('admin'))$q$, 'BV409');
  PERFORM pg_temp.expect_error('L26e', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-1', pg_temp.actor('admin'))$q$, 'BV409', 'already published');
END $t$;
