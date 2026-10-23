-- Included by run_precision_tests.sql. F5 Track A product surface (0025/0026): append-only guards on precision_turn /
-- precision_journey_event / crp_confirmation, cross-project guards, access-token update restrictions and delete block,
-- runtime-role privileges and unique constraints. Helpers (new_project, new_cat, new_pa, complete_cat, expect_error,
-- assert_that) come from the runner and 50_additive.sql.

\echo '--- S01-S12 (precision_turn: append-only, project scoping, shape, uniqueness) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Sturn'); q UUID := pg_temp.new_project('Sturnb'); c UUID; cq UUID; t UUID;
BEGIN
  c := pg_temp.new_cat(p, 'logistics', 'cmv-logistics-1');
  cq := pg_temp.new_cat(q, 'logistics', 'cmv-logistics-1');
  INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content)
    VALUES (p, c, 'turn-key-0001', 'client', 'category', 'en', 'We ship monthly.') RETURNING id INTO t;
  PERFORM pg_temp.assert_that('S01', (SELECT seq FROM precision_turn WHERE id = t) IS NOT NULL, 'a turn is stored with a generated sequence');
  INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, kind, locale, content)
    VALUES (p, c, 'turn-key-0001', 'assistant', 'category', 'notice', 'en', 'Noted.');
  PERFORM pg_temp.assert_that('S02', (SELECT count(*) FROM precision_turn WHERE project_id = p AND turn_key = 'turn-key-0001') = 2, 'the client and assistant rows share a turn key');
  PERFORM pg_temp.expect_error('S03', format($q$UPDATE precision_turn SET content = 'edited' WHERE id = %L$q$, t), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('S04', format($q$DELETE FROM precision_turn WHERE id = %L$q$, t), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('S05', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0002', 'client', 'category', 'en', 'x')$q$, q, c), 'BV409', 'cross-project');
  PERFORM pg_temp.expect_error('S06', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0001', 'client', 'category', 'en', 'dup')$q$, p, c), '23505');
  PERFORM pg_temp.expect_error('S07', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'short', 'client', 'category', 'en', 'x')$q$, p, c), '23514', 'turn_key_format');
  PERFORM pg_temp.expect_error('S08', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0003', 'system', 'category', 'en', 'x')$q$, p, c), '23514', 'turn_role');
  PERFORM pg_temp.expect_error('S09', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0004', 'client', 'chat', 'en', 'x')$q$, p, c), '23514', 'turn_surface');
  PERFORM pg_temp.expect_error('S10', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0005', 'client', 'category', 'fr', 'x')$q$, p, c), '23514', 'turn_locale');
  PERFORM pg_temp.expect_error('S11', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (%L, %L, 'turn-key-0006', 'client', 'category', 'en', '')$q$, p, c), '23514', 'content_len');
  PERFORM pg_temp.expect_error('S12', format($q$INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, kind, locale, content) VALUES (%L, %L, 'turn-key-0007', 'assistant', 'category', 'reopened', 'en', 'x')$q$, p, c), '23514', 'turn_kind');
  -- the same turn key in another project is a different turn
  INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, locale, content) VALUES (q, cq, 'turn-key-0001', 'client', 'category', 'en', 'other project');
  PERFORM pg_temp.assert_that('S13', (SELECT count(*) FROM precision_turn WHERE turn_key = 'turn-key-0001' AND role = 'client') = 2, 'turn keys are unique per project, not globally');
END $t$;

\echo '--- S20-S27 (precision_journey_event: exactly-once, append-only, no free-form shapes) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Sevent'); e UUID; n INT;
BEGIN
  INSERT INTO precision_journey_event (event_name, event_key, project_id, properties) VALUES ('crp_confirmed', 'crp_confirmed:s-1', p, '{"category_key":"logistics"}') RETURNING id INTO e;
  INSERT INTO precision_journey_event (event_name, event_key, project_id) VALUES ('crp_confirmed', 'crp_confirmed:s-1', p) ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_that('S20', n = 0 AND (SELECT count(*) FROM precision_journey_event WHERE event_key = 'crp_confirmed:s-1') = 1, 'the same event key never produces a second row (ON CONFLICT DO NOTHING)');
  PERFORM pg_temp.expect_error('S21', format($q$INSERT INTO precision_journey_event (event_name, event_key, project_id) VALUES ('crp_confirmed', 'crp_confirmed:s-1', %L)$q$, p), '23505');
  PERFORM pg_temp.expect_error('S22', format($q$UPDATE precision_journey_event SET properties = '{}' WHERE id = %L$q$, e), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('S23', format($q$DELETE FROM precision_journey_event WHERE id = %L$q$, e), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('S24', format($q$INSERT INTO precision_journey_event (event_name, event_key, project_id) VALUES ('Crp Confirmed', 'k-s-24', %L)$q$, p), '23514', 'event_name');
  PERFORM pg_temp.expect_error('S25', format($q$INSERT INTO precision_journey_event (event_name, event_key, project_id, properties) VALUES ('crp_confirmed', 'k-s-25', %L, '["a"]')$q$, p), '23514', 'props_object');
  PERFORM pg_temp.expect_error('S26', $q$INSERT INTO precision_journey_event (event_name, event_key, project_id) VALUES ('crp_confirmed', 'k-s-26', gen_random_uuid())$q$, '23503');
  PERFORM pg_temp.assert_that('S27', (SELECT occurred_at FROM precision_journey_event WHERE id = e) IS NOT NULL, 'the server stamps the event time');
END $t$;

\echo '--- S30-S38 (crp_confirmation: one per pack, append-only, same-project pack) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Sconf'); q UUID := pg_temp.new_project('Sconfb'); c UUID; pk UUID; k UUID; cid UUID;
BEGIN
  c := pg_temp.new_cat(p, 'logistics', 'cmv-logistics-1');
  pk := pg_temp.complete_cat(c, 'operational');
  INSERT INTO crp_confirmation (pack_id, project_id) VALUES (pk, p) RETURNING id INTO cid;
  PERFORM pg_temp.assert_that('S30', (SELECT confirmed_at FROM crp_confirmation WHERE id = cid) IS NOT NULL, 'a confirmation is dated by the server');
  PERFORM pg_temp.assert_that('S31', (SELECT lifecycle_status FROM category_assessment WHERE instance_id = c) = 'completed' AND (SELECT current_pack_id FROM category_assessment WHERE instance_id = c) = pk, 'completing a category and confirming its pack leave the pack current');
  PERFORM pg_temp.expect_error('S32', format($q$INSERT INTO crp_confirmation (pack_id, project_id) VALUES (%L, %L)$q$, pk, p), '23505');
  INSERT INTO crp_confirmation (pack_id, project_id) VALUES (pk, p) ON CONFLICT (pack_id) DO NOTHING;
  PERFORM pg_temp.assert_that('S33', (SELECT count(*) FROM crp_confirmation WHERE pack_id = pk) = 1, 'confirming twice is a no-op with ON CONFLICT');
  PERFORM pg_temp.expect_error('S34', format($q$UPDATE crp_confirmation SET confirmed_at = now() WHERE id = %L$q$, cid), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('S35', format($q$DELETE FROM crp_confirmation WHERE id = %L$q$, cid), 'BV409', 'append-only');
  -- a pack of one project cannot be confirmed under another project
  k := pg_temp.new_cat(q, 'logistics', 'cmv-logistics-1');
  PERFORM pg_temp.expect_error('S36', format($q$INSERT INTO crp_confirmation (pack_id, project_id) VALUES (%L, %L)$q$, pk, q), 'BV409', 'cross-project');
  PERFORM pg_temp.expect_error('S37', format($q$INSERT INTO crp_confirmation (pack_id, project_id) VALUES (gen_random_uuid(), %L)$q$, p), 'BV409', 'cross-project');
  -- a new version produces a new pack with its own confirmation; the first stays
  UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = c;
  PERFORM pg_temp.assert_that('S38', (SELECT current_pack_id FROM category_assessment WHERE instance_id = c) = pk, 'a new version leaves the confirmed pack current until a new pack is created');
END $t$;

\echo '--- S40-S52 (precision_access_token: only consumption/revocation change; never deleted; hashed) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Stoken'); id1 UUID; id2 UUID; h1 TEXT := encode(sha256('link-one'::bytea), 'hex'); h2 TEXT := encode(sha256('link-two'::bytea), 'hex');
BEGIN
  INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES (h1, p, 'link', now() + interval '1 day') RETURNING id INTO id1;
  INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES (h2, p, 'session', now() + interval '1 hour') RETURNING id INTO id2;
  PERFORM pg_temp.expect_error('S40', format($q$INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES (%L, %L, 'link', now())$q$, h1, p), '23505');
  PERFORM pg_temp.expect_error('S41', format($q$INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES ('not-a-hash', %L, 'link', now())$q$, p), '23514', 'hash_format');
  PERFORM pg_temp.expect_error('S42', format($q$INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES (%L, %L, 'admin', now())$q$, encode(sha256('x'::bytea), 'hex'), p), '23514', 'kind');
  UPDATE precision_access_token SET consumed_at = now() WHERE id = id1;
  PERFORM pg_temp.assert_that('S43', (SELECT consumed_at FROM precision_access_token WHERE id = id1) IS NOT NULL, 'a link can be consumed');
  PERFORM pg_temp.expect_error('S44', format($q$UPDATE precision_access_token SET consumed_at = now() + interval '1 second' WHERE id = %L$q$, id1), 'BV409', 'already consumed');
  UPDATE precision_access_token SET revoked_at = now() WHERE id = id2;
  PERFORM pg_temp.assert_that('S45', (SELECT revoked_at FROM precision_access_token WHERE id = id2) IS NOT NULL, 'a session can be revoked');
  PERFORM pg_temp.expect_error('S46', format($q$UPDATE precision_access_token SET token_hash = %L WHERE id = %L$q$, encode(sha256('y'::bytea), 'hex'), id2), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S47', format($q$UPDATE precision_access_token SET expires_at = now() + interval '30 days' WHERE id = %L$q$, id2), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S48', format($q$UPDATE precision_access_token SET kind = 'link' WHERE id = %L$q$, id2), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S49', format($q$UPDATE precision_access_token SET project_id = %L WHERE id = %L$q$, pg_temp.new_project('Stokenb'), id2), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S50', format($q$DELETE FROM precision_access_token WHERE id = %L$q$, id1), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('S51', format($q$DELETE FROM precision_access_token WHERE project_id = %L$q$, p), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('S52', $q$INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES (repeat('a', 64), gen_random_uuid(), 'link', now())$q$, '23503');
END $t$;

\echo '--- S60-S64 (precision_config / cover assets / cover seen: uniqueness and shape) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Sconfig'); n INT;
BEGIN
  INSERT INTO precision_config (key, locale, value) VALUES ('help_center_url_s', 'en', '"https://help.example/en"'::jsonb);
  PERFORM pg_temp.expect_error('S60', $q$INSERT INTO precision_config (key, locale, value) VALUES ('help_center_url_s', 'en', '"https://help.example/other"'::jsonb)$q$, '23505');
  INSERT INTO precision_config (key, locale, value, is_active) VALUES ('help_center_url_s', 'en', '"https://help.example/old"'::jsonb, false);
  INSERT INTO precision_config (key, locale, value) VALUES ('help_center_url_s', 'es', '"https://help.example/es"'::jsonb);
  PERFORM pg_temp.assert_that('S61', (SELECT count(*) FROM precision_config WHERE key = 'help_center_url_s') = 3, 'inactive history and other locales coexist with the one active row per (key, locale)');
  PERFORM pg_temp.expect_error('S62', $q$INSERT INTO precision_config (key, locale, value) VALUES ('Bad Key', '*', '1')$q$, '23514', 'config_key');
  PERFORM pg_temp.expect_error('S63', $q$INSERT INTO precision_config (key, locale, value) VALUES ('ok_key_s', 'fr', '1')$q$, '23514', 'config_locale');
  INSERT INTO precision_cover_seen (project_id) VALUES (p);
  INSERT INTO precision_cover_seen (project_id) VALUES (p) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_that('S64', n = 0 AND (SELECT count(*) FROM precision_cover_seen WHERE project_id = p) = 1, 'the cover mark is written once per project (idempotent)');
  INSERT INTO precision_cover_asset (country_code, asset_ref) VALUES ('ZZ', 'asset-s-1');
  PERFORM pg_temp.expect_error('S65', $q$INSERT INTO precision_cover_asset (country_code, asset_ref) VALUES ('ZZ', 'asset-s-2')$q$, '23505');
  PERFORM pg_temp.expect_error('S66', $q$INSERT INTO precision_cover_asset (country_code, asset_ref) VALUES ('zz1', 'asset-s-3')$q$, '23514', 'cover_asset_country');
  PERFORM pg_temp.expect_error('S67', $q$INSERT INTO precision_cover_asset (country_code, asset_ref, focal_x) VALUES ('YY', 'asset-s-4', 1.5)$q$, '23514', 'focal');
  PERFORM pg_temp.assert_that('S68', (SELECT NOT is_active AND NOT approved FROM precision_cover_asset WHERE country_code = 'ZZ'), 'a cover asset starts neither approved nor active');
END $t$;

\echo '--- S70-S78 (runtime role: least privilege on the product-surface tables) ---'
DO $t$
BEGIN
  PERFORM pg_temp.assert_that('S70', has_table_privilege('beeside_runtime_role', 'precision_turn', 'INSERT') AND has_table_privilege('beeside_runtime_role', 'precision_turn', 'SELECT'), 'the runtime role can append and read turns');
  PERFORM pg_temp.assert_that('S71', NOT has_table_privilege('beeside_runtime_role', 'precision_turn', 'UPDATE'), 'UPDATE on precision_turn is revoked');
  PERFORM pg_temp.assert_that('S72', NOT has_table_privilege('beeside_runtime_role', 'precision_journey_event', 'UPDATE'), 'UPDATE on precision_journey_event is revoked');
  PERFORM pg_temp.assert_that('S73', NOT has_table_privilege('beeside_runtime_role', 'crp_confirmation', 'UPDATE'), 'UPDATE on crp_confirmation is revoked');
  PERFORM pg_temp.assert_that('S74', NOT has_table_privilege('beeside_runtime_role', 'precision_access_token', 'UPDATE'), 'no table-wide UPDATE on precision_access_token');
  PERFORM pg_temp.assert_that('S75', has_column_privilege('beeside_runtime_role', 'precision_access_token', 'consumed_at', 'UPDATE') AND has_column_privilege('beeside_runtime_role', 'precision_access_token', 'revoked_at', 'UPDATE'), 'consumed_at and revoked_at are updatable');
  PERFORM pg_temp.assert_that('S76', NOT has_column_privilege('beeside_runtime_role', 'precision_access_token', 'token_hash', 'UPDATE')
    AND NOT has_column_privilege('beeside_runtime_role', 'precision_access_token', 'expires_at', 'UPDATE')
    AND NOT has_column_privilege('beeside_runtime_role', 'precision_access_token', 'project_id', 'UPDATE')
    AND NOT has_column_privilege('beeside_runtime_role', 'precision_access_token', 'kind', 'UPDATE'), 'no other column of the token table is updatable');
  PERFORM pg_temp.assert_that('S77', NOT has_table_privilege('beeside_runtime_role', 'oh_delivery', 'UPDATE'), 'the delivery ledger is append-only for the runtime role');
  PERFORM pg_temp.assert_that('S78', has_table_privilege('beeside_runtime_role', 'crp_confirmation', 'INSERT') AND has_table_privilege('beeside_runtime_role', 'precision_journey_event', 'INSERT'), 'the runtime role can insert confirmations and events');
END $t$;
