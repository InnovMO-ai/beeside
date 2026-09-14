-- Included by run_versioning_tests.sql (inside its transaction). Assertions L27–L35.

\echo '--- L27: content-only change is CONTENT and needs only a lightweight approval ---'
DO $t$
DECLARE
  v_row JSONB;
  v_review config_version_review%ROWTYPE;
BEGIN
  PERFORM config_create_draft('QUESTION_BANK', 'vt-qb-2', pg_temp.bundle('qb2'), pg_temp.actor('admin'));
  PERFORM config_submit_for_preview('QUESTION_BANK', 'vt-qb-2', pg_temp.actor('admin'));
  v_row := pg_temp.version_row('QUESTION_BANK', 'vt-qb-2');
  PERFORM config_record_review('QUESTION_BANK', 'vt-qb-2', pg_temp.actor('reviewer'), 'APPROVED', false, 'copy-only change');
  PERFORM config_publish('QUESTION_BANK', 'vt-qb-2', pg_temp.actor('admin'));
  SELECT * INTO v_review FROM config_version_review
   WHERE question_bank_version = 'vt-qb-2' ORDER BY reviewed_at DESC, review_id DESC LIMIT 1;
  PERFORM pg_temp.assert_that('L27',
    v_row ->> 'change_kind' = 'CONTENT' AND v_row ->> 'base_version' = 'vt-qb-1'
    AND NOT v_review.diff_reviewed AND jsonb_array_length(v_review.diff) > 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_review.diff) AS d WHERE d ->> 'path' NOT LIKE '%.copy%')
    AND pg_temp.current_version('QUESTION_BANK') = 'vt-qb-2'
    AND (pg_temp.version_row('QUESTION_BANK', 'vt-qb-1') ->> 'is_current')::boolean = false,
    'copy-only change classified CONTENT and published with a lightweight approval; diff touches only copy');
END $t$;

\echo '--- L28-L32: logic classification, no-op publishes, stale base, re-review, rules registry ---'
DO $t$
DECLARE
  v_preview JSONB;
  v_row JSONB;
BEGIN
  PERFORM config_create_draft('QUESTION_BANK', 'vt-qb-3', pg_temp.bundle('qb3'), pg_temp.actor('admin'));
  v_preview := config_submit_for_preview('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'));
  PERFORM pg_temp.assert_that('L28',
    v_preview ->> 'change_kind' = 'LOGIC_SCHEMA' AND v_preview ->> 'base_version' = 'vt-qb-2'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_preview -> 'diff') AS d
                WHERE d ->> 'path' = '$.questions[0].options[2]' AND d ->> 'op' = 'added'),
    'adding an option value is classified LOGIC_SCHEMA even though it also carries copy');

  PERFORM config_create_draft('QUESTION_BANK', 'vt-qb-same', pg_temp.bundle('qb2'), pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L29', $q$SELECT config_submit_for_preview('QUESTION_BANK', 'vt-qb-same', pg_temp.actor('admin'))$q$, 'BV422', 'identical');

  -- vt-qb-4 is previewed against the same base (vt-qb-2) and published first.
  PERFORM pg_temp.publish_flow('QUESTION_BANK', 'vt-qb-4', pg_temp.bundle('qb4'));
  PERFORM config_record_review('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('reviewer'), 'APPROVED', true, 'diff reviewed against vt-qb-2');
  PERFORM pg_temp.expect_error('L30', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'))$q$, 'BV412', 'changed since preview');

  PERFORM config_return_to_draft('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'), 'rebase onto vt-qb-4');
  PERFORM config_submit_for_preview('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'));
  PERFORM pg_temp.expect_error('L31a', $q$SELECT config_publish('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'))$q$, 'BV412', 'different base');
  PERFORM config_record_review('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('reviewer'), 'APPROVED', true, 'diff reviewed against vt-qb-4');
  PERFORM config_publish('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'));
  v_row := pg_temp.version_row('QUESTION_BANK', 'vt-qb-3');
  PERFORM pg_temp.assert_that('L31b',
    pg_temp.current_version('QUESTION_BANK') = 'vt-qb-3' AND v_row ->> 'base_version' = 'vt-qb-4'
    AND EXISTS (SELECT 1 FROM config_version_event WHERE question_bank_version = 'vt-qb-3' AND event_type = 'RETURNED_TO_DRAFT'),
    'after returning to draft and re-previewing, publish needed a fresh review against the new base');

  PERFORM pg_temp.publish_flow('RULES_ENGINE', 'vt-re-1', pg_temp.bundle('re1'));
  PERFORM config_create_draft('RULES_ENGINE', 'vt-re-2', pg_temp.bundle('re2'), pg_temp.actor('admin'));
  v_preview := config_submit_for_preview('RULES_ENGINE', 'vt-re-2', pg_temp.actor('admin'));
  PERFORM pg_temp.assert_that('L32',
    v_preview ->> 'change_kind' = 'LOGIC_SCHEMA' AND v_preview ->> 'base_version' = 'vt-re-1'
    AND config_strip_copy(pg_temp.bundle('re1')) = config_strip_copy(pg_temp.bundle('re2')),
    'a rules_engine bundle is always LOGIC_SCHEMA, even when only copy changed');
END $t$;

\echo '--- L33a-L33e: rollback = repoint current to a previously published version ---'
DO $t$
DECLARE
  v_hash_before TEXT := pg_temp.version_row('QUESTION_BANK', 'vt-qb-3') ->> 'content_hash';
BEGIN
  PERFORM config_set_current('QUESTION_BANK', 'vt-qb-2', pg_temp.actor('admin'), 'rollback: vt-qb-3 wording issue');
  PERFORM pg_temp.assert_that('L33a',
    pg_temp.current_version('QUESTION_BANK') = 'vt-qb-2'
    AND pg_temp.version_row('QUESTION_BANK', 'vt-qb-3') ->> 'status' = 'PUBLISHED'
    AND pg_temp.version_row('QUESTION_BANK', 'vt-qb-3') ->> 'content_hash' = v_hash_before
    AND EXISTS (SELECT 1 FROM config_version_event WHERE question_bank_version = 'vt-qb-2' AND event_type = 'CURRENT_REPOINTED'
                AND details ->> 'previous_current' = 'vt-qb-3' AND details ->> 'reason' LIKE 'rollback:%'),
    'current repointed to vt-qb-2 with an audited reason; vt-qb-3 stays PUBLISHED and unchanged');
  PERFORM pg_temp.expect_error('L33b', $q$SELECT config_set_current('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('admin'), '')$q$, 'BV422');
  PERFORM pg_temp.expect_error('L33c', $q$SELECT config_set_current('QUESTION_BANK', 'vt-qb-bad', pg_temp.actor('admin'), 'try a draft')$q$, 'BV409');
  PERFORM pg_temp.expect_error('L33d', $q$SELECT config_set_current('QUESTION_BANK', 'vt-qb-3', pg_temp.actor('supervisor'), 'not allowed')$q$, 'BV403');
  PERFORM pg_temp.expect_error('L33e', $q$SELECT config_set_current('QUESTION_BANK', 'vt-qb-2', pg_temp.actor('admin'), 'already current')$q$, 'BV409');
END $t$;

\echo '--- L34a-L34d: audit trail is append-only, function-written, complete ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('L34a', $q$UPDATE config_version_event SET details = '{}' WHERE question_bank_version = 'vt-qb-1'$q$, 'P0001', 'append-only');
  PERFORM pg_temp.expect_error('L34b', $q$DELETE FROM config_version_review WHERE question_bank_version = 'vt-qb-1'$q$, 'P0001', 'append-only');
  PERFORM pg_temp.expect_error('L34c',
    $q$INSERT INTO config_version_review (registry, question_bank_version, content_hash, change_kind, diff, decision, reviewer_admin_user_id)
       VALUES ('QUESTION_BANK', 'vt-qb-3', 'forged', 'CONTENT', '[]', 'APPROVED', pg_temp.actor('admin'))$q$, 'BV403');
  PERFORM pg_temp.assert_that('L34d',
    ARRAY(SELECT event_type FROM config_version_event WHERE question_bank_version = 'vt-qb-3' ORDER BY occurred_at, event_id)
      = ARRAY['DRAFT_CREATED', 'SUBMITTED_FOR_PREVIEW', 'REVIEW_RECORDED', 'RETURNED_TO_DRAFT',
              'SUBMITTED_FOR_PREVIEW', 'REVIEW_RECORDED', 'PUBLISHED']::config_version_event_type[],
    'every lifecycle step of vt-qb-3 is recorded, in order');
END $t$;

\echo '--- L35: placeholder bundles shipped in the repository are valid ---'
DO $t$
BEGIN
  PERFORM config_create_draft('QUESTION_BANK', 'vt-ph-qb', pg_temp.bundle('qb_placeholder'), pg_temp.actor('admin'));
  PERFORM config_create_draft('RULES_ENGINE', 'vt-ph-re', pg_temp.bundle('re_placeholder'), pg_temp.actor('admin'));
  PERFORM config_create_draft('SNAPSHOT_TEMPLATE', 'vt-ph-st', pg_temp.bundle('st_placeholder'), pg_temp.actor('admin'));
  PERFORM config_submit_for_preview('QUESTION_BANK', 'vt-ph-qb', pg_temp.actor('admin'));
  PERFORM config_submit_for_preview('RULES_ENGINE', 'vt-ph-re', pg_temp.actor('admin'));
  PERFORM config_submit_for_preview('SNAPSHOT_TEMPLATE', 'vt-ph-st', pg_temp.actor('admin'));
  PERFORM pg_temp.assert_that('L35',
    pg_temp.version_row('QUESTION_BANK', 'vt-ph-qb') ->> 'status' = 'PREVIEW'
    AND pg_temp.version_row('RULES_ENGINE', 'vt-ph-re') ->> 'status' = 'PREVIEW'
    AND pg_temp.version_row('SNAPSHOT_TEMPLATE', 'vt-ph-st') ->> 'status' = 'PREVIEW',
    'db/config-bundles/placeholder/*.json pass bundle validation for all three registries');
END $t$;
