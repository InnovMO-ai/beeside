-- Included by run_precision_tests.sql. Precision V1.0: understanding frame (optimistic version, append-only events) and the Knowledge
-- Service (source hierarchy enforced in the database, immutable documents/passages, supersession, Spanish accent-insensitive search).

\echo '--- U01-U12 (understanding frame + events) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Ufr'); q UUID := pg_temp.new_project('Ufrq'); e UUID;
BEGIN
  INSERT INTO understanding_frame (project_id, locale, frame) VALUES (p, 'es', '{"version":1}');
  PERFORM pg_temp.assert_that('U01', (SELECT version FROM understanding_frame WHERE project_id = p) = 1, 'a frame starts at version 1');
  UPDATE understanding_frame SET version = 2, frame = '{"version":2}' WHERE project_id = p;
  PERFORM pg_temp.assert_that('U02', (SELECT version FROM understanding_frame WHERE project_id = p) = 2, 'a write advances the version by one');
  PERFORM pg_temp.expect_error('U03', format($q$UPDATE understanding_frame SET version = 2, frame = '{}' WHERE project_id = %L$q$, p), 'BV409', 'stale write');
  PERFORM pg_temp.expect_error('U04', format($q$UPDATE understanding_frame SET version = 5 WHERE project_id = %L$q$, p), 'BV409', 'advance by one');
  PERFORM pg_temp.expect_error('U05', format($q$UPDATE understanding_frame SET project_id = %L, version = 3 WHERE project_id = %L$q$, q, p), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('U06', format($q$INSERT INTO understanding_frame (project_id, locale, frame) VALUES (%L, 'fr', '{}')$q$, q), '23514', 'locale');
  PERFORM pg_temp.expect_error('U07', format($q$INSERT INTO understanding_frame (project_id, locale, frame) VALUES (%L, 'es', '[]')$q$, q), '23514', 'object');
  INSERT INTO understanding_frame_event (project_id, turn_key, kind, frame_version, payload) VALUES (p, 'turn-key-0001', 'turn', 2, '{"changed":["workforce.headcount"]}') RETURNING id INTO e;
  PERFORM pg_temp.assert_that('U08', (SELECT seq FROM understanding_frame_event WHERE id = e) IS NOT NULL, 'an event gets a sequence');
  PERFORM pg_temp.expect_error('U09', format($q$INSERT INTO understanding_frame_event (project_id, turn_key, kind, frame_version) VALUES (%L, 'turn-key-0001', 'turn', 2)$q$, p), '23505');
  PERFORM pg_temp.expect_error('U10', format($q$UPDATE understanding_frame_event SET payload = '{}' WHERE id = %L$q$, e), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('U11', format($q$DELETE FROM understanding_frame_event WHERE id = %L$q$, e), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('U12', format($q$INSERT INTO understanding_frame_event (project_id, turn_key, kind, frame_version) VALUES (%L, 'turn-key-0002', 'chat', 1)$q$, p), '23514', 'kind');
END
$t$;

\echo '--- K01-K18 (knowledge: hierarchy, immutability, supersession, editions, search) ---'
DO $t$
DECLARE d1 TEXT := 'imco-ice:ice:v1'; d2 TEXT := 'imco-ice:ice:v2'; h TEXT := repeat('a', 64);
BEGIN
  INSERT INTO knowledge_source (id, institution, domains, jurisdiction, topics, authority, roles, is_primary, cadence, risk, review_required, granularity)
    VALUES ('imco-ice', 'IMCO', ARRAY['imco.org.mx'], 'MX', ARRAY['labor_market'], 'trusted_institutional', ARRAY['context','analysis'], false, 'biennial', 'medium', true, 'state');
  PERFORM pg_temp.expect_error('K01', $q$INSERT INTO knowledge_source (id, institution, domains, jurisdiction, topics, authority, roles, is_primary, cadence, risk, review_required, granularity)
    VALUES ('bad-src', 'X', ARRAY['x.org'], 'MX', ARRAY['taxes'], 'trusted_institutional', ARRAY['obligation'], false, 'annual', 'low', false, 'country')$q$, '23514', 'obligation_authority');
  PERFORM pg_temp.expect_error('K02', $q$INSERT INTO knowledge_source (id, institution, domains, jurisdiction, topics, authority, roles, is_primary, cadence, risk, review_required, granularity)
    VALUES ('hi-risk', 'X', ARRAY['x.org'], 'MX', ARRAY['taxes'], 'official_primary', ARRAY['obligation'], true, 'annual', 'high', false, 'country')$q$, '23514', 'high_risk_review');
  INSERT INTO knowledge_source (id, institution, domains, jurisdiction, topics, authority, roles, is_primary, cadence, risk, review_required, granularity)
    VALUES ('sat', 'SAT', ARRAY['sat.gob.mx'], 'MX', ARRAY['taxes'], 'official_primary', ARRAY['obligation'], true, 'continuous', 'high', true, 'country');
  PERFORM pg_temp.assert_that('K03', (SELECT count(*) FROM knowledge_source) = 2, 'an official primary source may ground obligations; an analytical one may not');

  INSERT INTO knowledge_document (id, source_id, title, edition, version, retrieved_at, jurisdiction, locator, content_hash, confidence) VALUES (d1, 'imco-ice', 'ICE', '2025', 1, now(), 'MX', 'https://imco.org.mx/ice', h, 'medium');
  INSERT INTO knowledge_passage (id, document_id, source_id, ordinal, text, location, granularity) VALUES (d1 || ':0', d1, 'imco-ice', 0, 'La informalidad laboral y los salarios varían entre estados.', 'p. 3', 'state');
  PERFORM pg_temp.assert_that('K04', (SELECT count(*) FROM knowledge_passage WHERE tsv @@ plainto_tsquery('spanish', knowledge_fold('informalidad laboral'))) = 1, 'full-text search finds a passage');
  PERFORM pg_temp.assert_that('K05', (SELECT count(*) FROM knowledge_passage WHERE tsv @@ plainto_tsquery('spanish', knowledge_fold('VARIAN salarios'))) = 1, 'search is accent- and case-insensitive');
  PERFORM pg_temp.expect_error('K06', format($q$INSERT INTO knowledge_passage (id, document_id, source_id, ordinal, text, location, granularity) VALUES ('x:0', %L, 'sat', 0, 't', 'p. 1', 'state')$q$, d1), 'BV409', 'source does not match');
  PERFORM pg_temp.expect_error('K07', format($q$UPDATE knowledge_passage SET text = 'changed' WHERE id = %L$q$, d1 || ':0'), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('K08', format($q$DELETE FROM knowledge_passage WHERE id = %L$q$, d1 || ':0'), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('K09', format($q$UPDATE knowledge_document SET title = 'Other' WHERE id = %L$q$, d1), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('K10', format($q$DELETE FROM knowledge_document WHERE id = %L$q$, d1), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('K11', format($q$INSERT INTO knowledge_document (id, source_id, title, edition, version, retrieved_at, jurisdiction, locator, content_hash, confidence) VALUES ('d-dup', 'imco-ice', 'ICE', '2025', 1, now(), 'MX', 'l', %L, 'medium')$q$, h), '23505');

  INSERT INTO knowledge_document (id, source_id, title, edition, version, retrieved_at, jurisdiction, locator, content_hash, confidence) VALUES (d2, 'imco-ice', 'ICE', '2027', 2, now(), 'MX', 'https://imco.org.mx/ice2', repeat('b', 64), 'medium');
  PERFORM pg_temp.expect_error('K12', format($q$UPDATE knowledge_document SET status = 'superseded', superseded_by_id = %L WHERE id = %L$q$, d1, d2), 'BV409', 'newer version');
  UPDATE knowledge_document SET status = 'superseded', superseded_by_id = d2 WHERE id = d1;
  UPDATE knowledge_document SET supersedes_id = d1 WHERE id = d2;
  PERFORM pg_temp.assert_that('K13', (SELECT status FROM knowledge_document WHERE id = d1) = 'superseded', 'a new edition supersedes the previous one');
  PERFORM pg_temp.expect_error('K14', format($q$UPDATE knowledge_document SET status = 'active', superseded_by_id = NULL WHERE id = %L$q$, d1), 'BV409', 'cannot change state');
  PERFORM pg_temp.expect_error('K15', format($q$UPDATE knowledge_document SET status = 'superseded' WHERE id = %L$q$, d2), '23514', 'superseded_consistent');
  PERFORM pg_temp.expect_error('K16', $q$INSERT INTO country_resource (id, country_code, title, language, destination_kind, destination_ref, version, updated_at) VALUES ('r1', 'MX', 'Guide', 'en', 'url', 'http://insecure.example', '1', '2026-10-01')$q$, '23514', 'https');

  -- K17-K18: an OLDER edition that arrives after a newer one (higher version, earlier edition) is stored as historical, superseded by the newer edition
  INSERT INTO knowledge_document (id, source_id, title, edition, version, retrieved_at, jurisdiction, locator, content_hash, confidence) VALUES (d2 || '-old', 'imco-ice', 'ICE', '2023', 3, now(), 'MX', 'https://imco.org.mx/ice23', repeat('c', 64), 'medium');
  UPDATE knowledge_document SET status = 'superseded', superseded_by_id = d2 WHERE id = d2 || '-old';
  PERFORM pg_temp.assert_that('K17', (SELECT status FROM knowledge_document WHERE id = d2 || '-old') = 'superseded' AND (SELECT status FROM knowledge_document WHERE id = d2) = 'active', 'a late-arriving older edition is historical; the newer edition stays active');
  INSERT INTO knowledge_document (id, source_id, title, edition, version, retrieved_at, jurisdiction, locator, content_hash, confidence) VALUES (d2 || '-other', 'imco-ice', 'Otra publicación', '2030', 9, now(), 'MX', 'https://imco.org.mx/otra', repeat('d', 64), 'medium');
  PERFORM pg_temp.expect_error('K18', format($q$UPDATE knowledge_document SET status = 'superseded', superseded_by_id = %L WHERE id = %L$q$, d2 || '-other', d2), 'BV409', 'same publication');
END
$t$;

\echo '--- U20-U22 (privacy classification) ---'
DO $t$
BEGIN
  PERFORM pg_temp.assert_that('U20', (SELECT action FROM privacy_erasure_registry WHERE table_name = 'understanding_frame') = 'erase', 'the frame is erased with the project');
  PERFORM pg_temp.assert_that('U21', (SELECT erase_order FROM privacy_erasure_registry WHERE table_name = 'understanding_frame_event') < (SELECT erase_order FROM privacy_erasure_registry WHERE table_name = 'precision_instance'), 'events are erased before the instance');
  PERFORM pg_temp.assert_that('U22', (SELECT count(*) FROM privacy_erasure_registry WHERE table_name LIKE 'knowledge_%' AND action = 'global') = 6, 'knowledge tables (incl. the demand registry) are global reference data');
END
$t$;

\echo '--- D1-D6 (knowledge demand: controlled vocabulary only) ---'
DO $t$
DECLARE ok text := $q$INSERT INTO knowledge_demand (id, country, topic, subtopic, category_key, service_key, info_type, coverage, disposition, reason, boundary, first_seen_at, last_seen_at) VALUES ('d1', 'MX', 'taxes', 'vat', 'tax_accounting_audit', 'CAP_HIVE_FI_TAX', 'tax_treatment', 'absent', 'candidate_knowledge', 'no_hits', NULL, now(), now())$q$;
BEGIN
  EXECUTE ok;
  PERFORM pg_temp.assert_that('D1', (SELECT status FROM knowledge_demand WHERE id = 'd1') = 'open', 'a new demand starts open');
  PERFORM pg_temp.expect_error('D2', replace(ok, $r$'vat'$r$, $r$'texto libre del cliente'$r$) || '', '23514', 'knowledge_demand_slugs');
  PERFORM pg_temp.expect_error('D3', replace(replace(ok, $r$'d1'$r$, $r$'d2'$r$), $r$'MX'$r$, $r$'Mexico'$r$), '23514', 'knowledge_demand_country');
  PERFORM pg_temp.expect_error('D4', $q$UPDATE knowledge_demand SET status = 'published' WHERE id = 'd1'$q$, '23514', 'knowledge_demand_status');
  PERFORM pg_temp.expect_error('D5', $q$INSERT INTO knowledge_demand_event (demand_id, project_ref, turn_ref, seen_at) VALUES ('d1', '8f0e2c1a-0000-0000-0000-000000000000', 'abc', now())$q$, '23514', 'knowledge_demand_event_refs');
  INSERT INTO knowledge_demand_event (demand_id, project_ref, turn_ref, seen_at) VALUES ('d1', repeat('a', 32), repeat('b', 32), now());
  PERFORM pg_temp.expect_error('D6', $q$INSERT INTO knowledge_demand_event (demand_id, project_ref, turn_ref, seen_at) VALUES ('d1', repeat('a', 32), repeat('b', 32), now())$q$, '23505', 'knowledge_demand_event_key');
END
$t$;
