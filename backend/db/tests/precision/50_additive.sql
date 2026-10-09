-- Included by run_precision_tests.sql. F5 additive layer (0019/0020): A01–A19 from the F1 additive-migrations
-- spec (prototype tests, ported to the repository harness). Setup (admin, fixtures, helpers) comes from the runner.

\echo '--- additive setup: extra manifests + helpers ---'
DO $$
DECLARE a UUID := current_setting('pt.admin')::uuid;
BEGIN
  INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id)
  SELECT k, 'cmv-'||k||'-1', '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}'::jsonb, a
  FROM unnest(ARRAY['_generic','strategic_advisory','ecosystem_development']) k;
  PERFORM precision_category_manifest_publish(k, 'cmv-'||k||'-1', a) FROM unnest(ARRAY['_generic','strategic_advisory','ecosystem_development']) k;
END $$;

CREATE FUNCTION pg_temp.new_cat(p_project UUID, p_key TEXT, p_mv TEXT) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO precision_instance (project_id, scope) VALUES (p_project, 'category') RETURNING id INTO v;
  INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin)
    VALUES (v, p_project, p_key, p_mv, 'pa_detected');
  RETURN v;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.new_pa(p_project UUID) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO precision_instance (project_id, scope) VALUES (p_project, 'project') RETURNING id INTO v;
  INSERT INTO precision_assessment (instance_id, manifest_version) VALUES (v, (SELECT version FROM project_manifest_version WHERE is_current));
  RETURN v;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.complete_cat(p_inst UUID, p_kind TEXT) RETURNS UUID AS $$
BEGIN
  UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = p_inst;
  UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = p_inst;
  RETURN category_assessment_complete(p_inst, jsonb_build_object('crp_kind', p_kind, 'version_label', 'v1.0'), '{}'::jsonb);
END $$ LANGUAGE plpgsql;

\echo '--- A01-A07 (M-A/M-B) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Aone'); i UUID;
BEGIN
  i := pg_temp.new_cat(p, 'new:public_procurement', 'cmv-_generic-1');
  PERFORM pg_temp.assert_that('A01', (SELECT manifest_category_key FROM category_assessment WHERE instance_id = i) = '_generic',
    'new:public_procurement inserts and derives manifest_category_key=_generic');
  PERFORM pg_temp.expect_error('A02', format($q$UPDATE category_assessment SET manifest_category_key = 'logistics' WHERE instance_id = %L$q$, i), '428C9');
  PERFORM pg_temp.expect_error('A03', format($q$INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_category_key, manifest_version, category_origin) VALUES (gen_random_uuid(), %L, 'logistics', '_generic', 'cmv-_generic-1', 'pa_detected')$q$, p), '428C9');
  PERFORM pg_temp.expect_error('A04', format($q$SELECT pg_temp.new_cat(%L, '_generic', 'cmv-_generic-1')$q$, p), '23514', 'category_key_format');
  PERFORM pg_temp.expect_error('A05', format($q$SELECT pg_temp.new_cat(%L, 'new:xx_other', 'cmv-_generic-999')$q$, p), '23503');
  PERFORM pg_temp.new_cat(p, 'new:second_need', 'cmv-_generic-1');
  PERFORM pg_temp.assert_that('A06a', (SELECT count(*) FROM category_assessment WHERE project_id = p AND category_key LIKE 'new:%') = 2, 'two distinct new: needs in one project');
  PERFORM pg_temp.expect_error('A06b', format($q$SELECT pg_temp.new_cat(%L, 'new:second_need', 'cmv-_generic-1')$q$, p), '23505', 'project_category_unique');
  PERFORM pg_temp.expect_error('A07', format($q$UPDATE category_assessment SET category_key = 'new:renamed' WHERE instance_id = %L$q$, i), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('A07b', format($q$SELECT pg_temp.new_cat(%L, 'logistics', 'cmv-hr-1')$q$, p), '23503');
END $t$;

\echo '--- A09-A12 (M-C/M-D context_pin / fact source) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Apin'); q UUID := pg_temp.new_project('Apin2'); pa UUID; pin UUID; pq UUID; f1 UUID; f2 UUID; r UUID := gen_random_uuid(); r2 UUID := gen_random_uuid(); nid UUID := gen_random_uuid();
BEGIN
  pa := pg_temp.new_pa(p);
  INSERT INTO context_pin (project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash)
    VALUES (p, 'fa4', p, r, '2026-10-04.v4', '0.2', 'v3', 'h1') RETURNING id INTO pin;
  PERFORM pg_temp.expect_error('A09a', format($q$INSERT INTO context_pin (project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash, status) VALUES (%L,'fa4',%L,%L,'c','0.2','v3','h2','current')$q$, p, p, r2), '23505', 'context_pin_one_current');
  PERFORM pg_temp.expect_error('A09b', format($q$INSERT INTO context_pin (project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash) VALUES (%L,'fa4',%L,%L,'c','0.2','v3','h3')$q$, p, p, r), '23505');
  PERFORM pg_temp.expect_error('A09c', format($q$DELETE FROM context_pin WHERE id = %L$q$, pin), 'BV409');
  PERFORM pg_temp.expect_error('A09d', format($q$UPDATE context_pin SET context_hash = 'x' WHERE id = %L$q$, pin), 'BV409');
  INSERT INTO context_pin (project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash)
    VALUES (q, 'fa4', q, gen_random_uuid(), 'c', '0.2', 'v3', 'hq') RETURNING id INTO pq;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM pg_temp.expect_error('A09e', format($q$UPDATE context_pin SET status='superseded', superseded_by_pin_id = %L WHERE id = %L$q$, pq, pin), '23503');
  SET CONSTRAINTS ALL DEFERRED;
  UPDATE context_pin SET status='superseded', superseded_by_pin_id = nid WHERE id = pin;
  INSERT INTO context_pin (id, project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash)
    VALUES (nid, p, 'fa4', p, r2, 'c', '0.2', 'v3', 'h9');
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM pg_temp.assert_that('A09f', (SELECT count(*) FROM context_pin WHERE project_id = p AND status='current') = 1 AND (SELECT superseded_by_pin_id FROM context_pin WHERE id = pin) = nid, 'supersede-then-insert protocol leaves exactly one current pin');
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.expect_error('A10', format($q$SELECT fact_record(%L, %L, 'precision.demo.field', '"x"', 'text', 'ANSWERED', 'precision_assessment', 'client_confirmed', NULL, %L, 'item1')$q$, p, pa, pq), 'BV409', 'source_pin_id');
  f1 := fact_record(p, pa, 'precision.demo.field', '"x"', 'text', 'ANSWERED', 'precision_assessment', 'client_confirmed', NULL, nid, 'item1');
  f2 := fact_record(p, pa, 'precision.demo.field', '"y"', 'text', 'ANSWERED', 'precision_assessment', 'client_corrected');
  PERFORM pg_temp.assert_that('A11', (SELECT source_pin_id FROM fact WHERE id = f1) = nid AND (SELECT superseded_by FROM fact WHERE id = f1) = f2 AND (SELECT source_pin_id FROM fact WHERE id = f2) IS NULL,
    'with-pin and without-pin both work; old row keeps its pin; chain intact');
  PERFORM pg_temp.expect_error('A11b', format($q$UPDATE fact SET source_pin_id = %L WHERE id = %L$q$, nid, f2), 'BV409');
  PERFORM pg_temp.expect_error('A11c', format($q$SELECT fact_record(%L, %L, 'precision.demo.f2', '"x"', 'text', 'ANSWERED', 'precision_assessment', 'client_confirmed', NULL, NULL, 'item1')$q$, p, pa), '23514', 'source_item_requires_pin');
  PERFORM pg_temp.expect_error('A12a', format($q$INSERT INTO context_pin (project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash, status) VALUES (%L,'fa4',%L,%L,'c','0.2','v3','h','current')$q$, p, p, r), '23505');
  PERFORM pg_temp.expect_error('A12b', format($q$SELECT pg_temp.new_pa(%L)$q$, p), '23505', 'one_pa_per_project');
END $t$;

\echo '--- A13-A15 (SA / ED instances) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Asa'); sa UUID; ed UUID; pk UUID;
BEGIN
  sa := pg_temp.new_cat(p, 'strategic_advisory', 'cmv-strategic_advisory-1');
  PERFORM pg_temp.assert_that('A13a', (SELECT manifest_category_key FROM category_assessment WHERE instance_id = sa) = 'strategic_advisory', 'SA instance inserts with its own manifest');
  PERFORM pg_temp.expect_error('A13b', format($q$SELECT pg_temp.new_cat(%L, 'strategic_advisory', 'cmv-strategic_advisory-1')$q$, p), '23505');
  PERFORM pg_temp.expect_error('A13c', format($q$SELECT pg_temp.new_cat(%L, 'strategic_advisory', 'cmv-logistics-1')$q$, pg_temp.new_project('Asa2')), '23503');
  pk := pg_temp.complete_cat(sa, 'strategic_advisory');
  PERFORM pg_temp.assert_that('A14', (SELECT current_pack_id FROM category_assessment WHERE instance_id = sa) = pk
    AND (SELECT content->>'crp_kind' FROM pack WHERE id = pk) = 'strategic_advisory'
    AND (SELECT lifecycle_status FROM category_assessment WHERE instance_id = sa) = 'completed', 'SA completion yields pack crp_kind=strategic_advisory and moves current_pack_id atomically');
  ed := pg_temp.new_cat(p, 'ecosystem_development', 'cmv-ecosystem_development-1');
  pk := pg_temp.complete_cat(ed, 'ecosystem_development');
  PERFORM pg_temp.assert_that('A15', (SELECT content->>'crp_kind' FROM pack WHERE id = pk) = 'ecosystem_development' AND (SELECT current_pack_id FROM category_assessment WHERE instance_id = ed) = pk, 'ED analogue');
END $t$;

\echo '--- A16 (M-E ASSUMED) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Aass'); pa UUID; f1 UUID; f2 UUID;
BEGIN
  pa := pg_temp.new_pa(p);
  f1 := fact_record(p, pa, 'precision.demo.assumed', '150', 'number', 'ASSUMED', 'precision_assessment', 'client_answered');
  PERFORM pg_temp.assert_that('A16a', (SELECT answer_state::text FROM fact WHERE id = f1) = 'ASSUMED', 'ASSUMED accepted');
  PERFORM pg_temp.expect_error('A16b', format($q$SELECT fact_record(%L, %L, 'precision.demo.bogus', '1', 'number', 'GUESSED', 'precision_assessment', 'client_answered')$q$, p, pa), '22P02');
  f2 := fact_record(p, pa, 'precision.demo.assumed', '160', 'number', 'ANSWERED', 'precision_assessment', 'client_corrected');
  PERFORM pg_temp.assert_that('A16c', (SELECT superseded_by FROM fact WHERE id = f1) = f2, 'ASSUMED superseded by ANSWERED keeps the chain');
END $t$;

\echo '--- A17 (M-F oh_delivery) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Aoh'); q UUID := pg_temp.new_project('Aoh2'); pa UUID; c UUID; pk UUID; qc UUID; qpk UUID; d UUID;
BEGIN
  pa := pg_temp.new_pa(p);
  c := pg_temp.new_cat(p, 'logistics', 'cmv-logistics-1'); pk := pg_temp.complete_cat(c, 'operational');
  qc := pg_temp.new_cat(q, 'logistics', 'cmv-logistics-1'); qpk := pg_temp.complete_cat(qc, 'operational');
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key) VALUES (p, 'crp', pk, 1, 'queued', p||':crp:'||pk||':1') RETURNING id INTO d;
  PERFORM pg_temp.assert_that('A17a', d IS NOT NULL, 'queued delivery recorded');
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, oh_reference) VALUES (p, 'crp', pk, 1, 'delivered', p||':crp:'||pk||':1', 'OH-REF-1');
  PERFORM pg_temp.assert_that('A17b', (SELECT status FROM oh_delivery_current WHERE idempotency_key = p||':crp:'||pk||':1') = 'delivered', 'current state = latest row');
  PERFORM pg_temp.expect_error('A17c', format($q$UPDATE oh_delivery SET status = 'failed' WHERE id = %L$q$, d), 'BV409');
  PERFORM pg_temp.expect_error('A17d', format($q$DELETE FROM oh_delivery WHERE id = %L$q$, d), 'BV409');
  PERFORM pg_temp.expect_error('A17e', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key) VALUES (%L,'crp',%L,1,'queued',%L)$q$, p, pk, p||':crp:'||pk||':1'), '23505');
  PERFORM pg_temp.expect_error('A17f', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key) VALUES (%L,'psm',%L,1,'queued','k-psm')$q$, p, pk), '23514', 'kind_artifact');
  PERFORM pg_temp.expect_error('A17g', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key) VALUES (%L,'crp',%L,1,'queued','k-cross')$q$, p, qpk), 'BV409', 'cross-project');
  PERFORM pg_temp.expect_error('A17h', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, error_code) VALUES (%L,'crp',%L,1,'queued','k-err','E1')$q$, p, pk), '23514', 'error_only_failed');
END $t$;

\echo '--- A18 (M-G new PSM version) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Apsm'); pa UUID; s1 UUID; s2 UUID; s2b UUID; s3 UUID;
BEGIN
  pa := pg_temp.new_pa(p);
  PERFORM pg_temp.expect_error('A18a', format($q$SELECT precision_psm_new_version(%L, 'req-0', '{}'::jsonb)$q$, pa), 'BV409', 'requires a confirmed');
  UPDATE precision_assessment SET lifecycle_status='in_progress' WHERE instance_id = pa;
  UPDATE precision_assessment SET lifecycle_status='ready_for_confirmation' WHERE instance_id = pa;
  s1 := precision_assessment_confirm(pa, '{"services":["logistics"]}');
  s2 := precision_psm_new_version(pa, 'req-1', '{"services":["logistics","tax_accounting_audit"],"delta":{"added":["tax_accounting_audit"]}}');
  s2b := precision_psm_new_version(pa, 'req-1', '{"services":["ignored"]}');
  s3 := precision_psm_new_version(pa, 'req-2', '{"services":["logistics","tax_accounting_audit","strategic_advisory"]}');
  PERFORM pg_temp.assert_that('A18b', s2b = s2 AND s3 <> s2, 'same request key returns the same snapshot; new key creates the next');
  PERFORM pg_temp.assert_that('A18c', (SELECT array_agg(version ORDER BY version) FROM service_map_snapshot WHERE precision_instance_id = pa) = ARRAY[1,2,3], 'versions 1,2,3 contiguous');
  PERFORM pg_temp.assert_that('A18d', (SELECT service_map_snapshot_id FROM precision_assessment WHERE instance_id = pa) = s3 AND (SELECT lifecycle_status FROM precision_assessment WHERE instance_id = pa) = 'confirmed', 'pointer on newest, PA confirmed');
  PERFORM pg_temp.expect_error('A18e', format($q$UPDATE service_map_snapshot SET content='{}' WHERE id = %L$q$, s1), 'BV409');
END $t$;

\echo '--- A19 (new CRP version keeps the old intact) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Aver'); c UUID; pk1 UUID; pk2 UUID;
BEGIN
  c := pg_temp.new_cat(p, 'logistics', 'cmv-logistics-1'); pk1 := pg_temp.complete_cat(c, 'operational');
  UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = c;
  pk2 := category_assessment_complete(c, '{"crp_kind":"operational","version_label":"v2.0","supersedes_id":null,"change_origin":"material_change"}', '{}');
  PERFORM pg_temp.assert_that('A19a', (SELECT current_pack_id FROM category_assessment WHERE instance_id = c) = pk2 AND (SELECT version FROM pack WHERE id = pk2) = 2, 'current pack is v2');
  PERFORM pg_temp.assert_that('A19b', (SELECT content->>'version_label' FROM pack WHERE id = pk1) = 'v1.0', 'v1 still readable and intact');
  PERFORM pg_temp.expect_error('A19c', format($q$UPDATE pack SET content = '{}' WHERE id = %L$q$, pk1), 'BV409');
END $t$;
