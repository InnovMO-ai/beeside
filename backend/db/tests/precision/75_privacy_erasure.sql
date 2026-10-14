-- Included by run_precision_tests.sql. Privacy erasure (migrations 0032/0033): the registry classifies every table, the policy gate
-- lives in the database, the guards open only for the flagged project and only on registered tables, and the runtime role cannot
-- delete Precision data by itself. The end-to-end erasure with real data is covered by the integration suites.

\echo '--- X01-X12: privacy erasure (registry, policy, gate, least privilege) ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  sup UUID := pg_temp.new_admin('pt-priv-super', 'SUPER_ADMIN');
  p UUID := pg_temp.locked_project('Xone');
  r JSONB;
  missing TEXT;
BEGIN
  SELECT string_agg(t.table_name, ', ') INTO missing
    FROM information_schema.tables t
   WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     AND NOT EXISTS (SELECT 1 FROM privacy_erasure_registry g WHERE g.table_name = t.table_name);
  PERFORM pg_temp.assert_that('X01', missing IS NULL, 'every table is classified in privacy_erasure_registry (missing: ' || COALESCE(missing, 'none') || ')');
  PERFORM pg_temp.expect_error('X02', $q$UPDATE privacy_erasure_registry SET action = 'keep' WHERE table_name = 'answer'$q$, 'BV409', 'migration');

  DELETE FROM privacy_policy WHERE false;  -- no-op: policies are never deleted
  UPDATE privacy_policy SET status = 'retired', retired_at = now() WHERE status = 'approved';
  PERFORM pg_temp.assert_that('X03', (privacy_erase_project(p, 'admin:test', false, now()) ->> 'reason') = 'no_approved_policy', 'without an approved policy the executor refuses');
  PERFORM pg_temp.expect_error('X04', format($q$INSERT INTO privacy_policy (min_days_after_block, retain_legal_acceptance, approved_by) VALUES (30, false, %L)$q$, adm), 'BV409', 'SUPER_ADMIN');
  INSERT INTO privacy_policy (min_days_after_block, retain_legal_acceptance, approved_by) VALUES (30, false, sup);
  PERFORM pg_temp.expect_error('X05', format($q$INSERT INTO privacy_policy (min_days_after_block, retain_legal_acceptance, approved_by) VALUES (1, false, %L)$q$, sup), '23505');
  PERFORM pg_temp.expect_error('X06', $q$UPDATE privacy_policy SET min_days_after_block = 0 WHERE status = 'approved'$q$, 'BV409', 'terms never change');

  PERFORM pg_temp.assert_that('X07', (privacy_erase_project(p, 'admin:test', false, now()) ->> 'reason') = 'not_blocked', 'an open project is not erased');
  INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (p, 'access_blocked', 'erasure_request', 'admin:' || sup);
  PERFORM pg_temp.assert_that('X08', (privacy_erase_project(p, 'admin:test', false, now()) ->> 'reason') = 'retention_window_open', 'the policy window must have elapsed');
  r := privacy_erase_project(p, 'admin:test', false, now() + interval '31 days');
  PERFORM pg_temp.assert_that('X09', (r ->> 'eligible')::boolean AND r ? 'would_delete', 'a blocked project past the window is eligible; the dry run writes nothing');
  PERFORM pg_temp.assert_that('X10', (SELECT count(*) FROM privacy_erasure_run WHERE project_id = p) = 0, 'a dry run leaves no run record');

  PERFORM pg_temp.assert_that('X11', NOT has_table_privilege('beeside_runtime_role', 'fact', 'DELETE') AND NOT has_table_privilege('beeside_runtime_role', 'pack', 'DELETE')
    AND NOT has_table_privilege('beeside_runtime_role', 'precision_turn', 'DELETE') AND NOT has_table_privilege('beeside_runtime_role', 'privacy_policy', 'UPDATE'),
    'the runtime role cannot delete Precision data or edit policies by itself; only the SECURITY DEFINER executor can');
  -- the flag alone opens nothing for the application role: it must come from inside the executor
  INSERT INTO project_access_token (project_id, kind, token_hash, expires_at) VALUES (p, (SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'fa_access_token_kind' ORDER BY e.enumsortorder LIMIT 1)::fa_access_token_kind, 'x75-' || p::text, now() + interval '1 day');
  SET LOCAL ROLE beeside_runtime_role;
  PERFORM set_config('app.privacy_erasure_project', p::text, true);
  PERFORM pg_temp.expect_error('X13', format($q$DELETE FROM project_access_token WHERE project_id = %L$q$, p), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('X14', format($q$INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (%L, 'anonymized', 'other', 'x')$q$, p), 'BV409', 'only by privacy_erase_project');
  PERFORM set_config('app.privacy_erasure_project', '', true);
  RESET ROLE;
  PERFORM pg_temp.assert_that('X12', has_function_privilege('beeside_runtime_role', 'privacy_erase_project(uuid,text,boolean,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'privacy_erase_project(uuid,text,boolean,timestamptz)', 'EXECUTE'), 'only the application role may call the executor');
END $t$;
