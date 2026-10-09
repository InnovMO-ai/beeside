-- Included by run_precision_tests.sql. F5 Track C: oh_delivery attempts (0021/0022).
\echo '--- C01-C07 (oh_delivery attempts: retry after failure, one delivered per key, terminal rows close a queued row) ---'
DO $t$
DECLARE p UUID := pg_temp.new_project('Cattempt'); c UUID; pk UUID; k TEXT; r RECORD;
BEGIN
  c := pg_temp.new_cat(p, 'logistics', 'cmv-logistics-1'); pk := pg_temp.complete_cat(c, 'operational');
  k := p||':crp:'||pk||':1';
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt) VALUES (p, 'crp', pk, 1, 'queued', k, 1);
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt, error_code) VALUES (p, 'crp', pk, 1, 'failed', k, 1, 'UNAVAILABLE');
  PERFORM pg_temp.assert_that('C01', (SELECT status FROM oh_delivery_current WHERE idempotency_key = k) = 'failed', 'first attempt failed');
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt) VALUES (p, 'crp', pk, 1, 'queued', k, 2);
  PERFORM pg_temp.assert_that('C02', (SELECT status || ':' || attempt FROM oh_delivery_current WHERE idempotency_key = k) = 'queued:2', 'a retry of a failed key queues attempt 2 (no unique violation)');
  PERFORM pg_temp.expect_error('C03', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt) VALUES (%L,'crp',%L,1,'queued',%L,2)$q$, p, pk, k), '23505');
  PERFORM pg_temp.expect_error('C04', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt, oh_reference) VALUES (%L,'crp',%L,1,'delivered',%L,3,'REF')$q$, p, pk, k), 'BV409', 'no matching queued');
  PERFORM pg_temp.expect_error('C05', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt) VALUES (%L,'crp',%L,1,'delivered',%L,2)$q$, p, pk, k), '23514', 'reference_only_delivered');
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt, oh_reference) VALUES (p, 'crp', pk, 1, 'delivered', k, 2, 'REF-2');
  PERFORM pg_temp.assert_that('C06', (SELECT status || ':' || attempt FROM oh_delivery_current WHERE idempotency_key = k) = 'delivered:2', 'attempt 2 delivered');
  -- a second delivered row for the same key is refused even with a fresh attempt number
  INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt) VALUES (p, 'crp', pk, 1, 'queued', k, 3);
  PERFORM pg_temp.expect_error('C07', format($q$INSERT INTO oh_delivery (project_id, kind, pack_id, artifact_version, status, idempotency_key, attempt, oh_reference) VALUES (%L,'crp',%L,1,'delivered',%L,3,'REF-3')$q$, p, pk, k), '23505', 'one_delivered');
END $t$;
