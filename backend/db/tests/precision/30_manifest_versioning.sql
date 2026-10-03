-- Included by run_precision_tests.sql. Assertions M01-M10: manifest version registries — two
-- independent registries, per-category_key current pointers, publish immutability, pin-at-creation.

\echo '--- M01-M05: category_manifest_version is independent per category_key (§19) ---'
DO $t$
BEGIN
  PERFORM pg_temp.assert_that('M01',
    (SELECT version FROM category_manifest_version WHERE category_key = 'hr' AND is_current) = 'cmv-hr-1',
    'hr is current on cmv-hr-1 after setup');
  PERFORM pg_temp.assert_that('M02',
    (SELECT version FROM category_manifest_version WHERE category_key = 'logistics' AND is_current) = 'cmv-logistics-1',
    'logistics is current on cmv-logistics-1, independently of hr');

  PERFORM precision_category_manifest_publish('hr', 'cmv-hr-2', current_setting('pt.admin')::uuid);
  PERFORM pg_temp.assert_that('M03',
    (SELECT version FROM category_manifest_version WHERE category_key = 'hr' AND is_current) = 'cmv-hr-2',
    'publishing a new hr version atomically repoints hr current to cmv-hr-2');
  PERFORM pg_temp.assert_that('M04',
    (SELECT version FROM category_manifest_version WHERE category_key = 'logistics' AND is_current) = 'cmv-logistics-1',
    'publishing a new Logistics-unrelated hr version never touches Logistics current version (§19 literal requirement)');
  PERFORM pg_temp.assert_that('M05',
    (SELECT count(*) FROM category_manifest_version WHERE category_key = 'hr' AND is_current) = 1
    AND (SELECT count(*) FROM category_manifest_version WHERE category_key = 'logistics' AND is_current) = 1,
    'exactly one current row per category_key, never zero or two');
END $t$;

\echo '--- M06-M08: published manifest rows are immutable except is_current ---'
DO $t$
BEGIN
  PERFORM pg_temp.expect_error('M06',
    $q$UPDATE category_manifest_version SET content = '{"fields": ["tampered"]}'::jsonb WHERE category_key = 'hr' AND version = 'cmv-hr-1'$q$,
    'BV409', 'published and immutable');
  PERFORM pg_temp.expect_error('M07',
    $q$UPDATE project_manifest_version SET content = '{"candidate_categories": []}'::jsonb WHERE version = 'pmv-pilot-1'$q$,
    'BV409', 'published and immutable');
  PERFORM pg_temp.assert_that('M08',
    (SELECT content FROM category_manifest_version WHERE category_key = 'hr' AND version = 'cmv-hr-1') = '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}'::jsonb,
    'cmv-hr-1 content is untouched by the rejected UPDATE (M06) and by hr moving current to cmv-hr-2 (M03) — it stays reproducible as "what was true then" (§10/§15)');
END $t$;

\echo '--- M09-M10: category_assessment pins the version current at ITS OWN creation, not a later one ---'
DO $t$
DECLARE
  v_project UUID := current_setting('pt.project_alpha')::uuid;
  v_instance UUID;
BEGIN
  INSERT INTO precision_instance (project_id, scope) VALUES (v_project, 'category') RETURNING id INTO v_instance;
  -- hr current is cmv-hr-2 at this point (after M03) — Add Category must pin that, not cmv-hr-1.
  INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
    VALUES (v_instance, v_project, 'hr', (SELECT version FROM category_manifest_version WHERE category_key = 'hr' AND is_current), 'client_added');
  PERFORM pg_temp.assert_that('M09',
    (SELECT manifest_version FROM category_assessment WHERE instance_id = v_instance) = 'cmv-hr-2',
    'Add Category pins the categorys currently-published version at the moment of creation (§19/§22)');

  PERFORM precision_category_manifest_publish('hr', 'cmv-hr-1', current_setting('pt.admin')::uuid);
  -- Republishing (rollback-style repoint to an earlier version is still just "publish"; cmv-hr-1 was
  -- never un-published, so this just re-sets is_current) must never retroactively repin this instance.
  PERFORM pg_temp.assert_that('M10',
    (SELECT manifest_version FROM category_assessment WHERE instance_id = v_instance) = 'cmv-hr-2',
    'a later repoint of hr current never touches an already-pinned category_assessment instance (§19)');
END $t$;
