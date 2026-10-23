-- PRIVACY GUARDS vs. THE CANONICAL RUNTIME LOGINS (finding F1 of the clone rehearsal review; Product Owner decision 2026-10-17, option A).
--
-- Problem: the erasure bypass guards (fa4_result_guard 0016, fa4_project_delivered_guard 0023) accept the transaction-local flag fa4.erasure='on' from any role that is NOT a
-- DIRECT member of beeside_runtime_role. In the legacy database the Discovery application login is a member, so the application cannot open the bypass. In the canonical
-- database the Discovery login belongs to beeside_discovery_rw (0051) and NOT to beeside_runtime_role (that is the point of the data-domain separation), so the guard treated it as an
-- operator: a session of the Discovery application could run set_config('fa4.erasure','on',true) and rewrite `answers` of a DELIVERED project (it holds UPDATE on fa4_project).
--
-- Fix: both guards deny the bypass to a direct member of EITHER application group. Operators stay able to use it: the migration owner and the SECURITY DEFINER function
-- fa4_anonymize_project() run as the owner, who belongs to neither group. Discovery is NOT added to beeside_runtime_role (no widening of any privilege): the predicate only names the
-- second group. Bodies are the 0016 / 0023 bodies with ONE changed predicate (the membership test is by role NAME, so it is a no-op on a database that has no beeside_discovery_rw).
-- Direct membership (pg_auth_members) is kept on purpose: pg_has_role() would be TRUE for every role for a superuser/owner.
-- Idempotent (CREATE OR REPLACE); no data change; rollback = re-create the 0016 / 0023 bodies.

CREATE OR REPLACE FUNCTION fa4_result_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND coalesce(current_setting('fa4.erasure', true), '') = 'on'
     AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                      WHERE r.rolname IN ('beeside_runtime_role', 'beeside_discovery_rw') AND u.rolname = current_user)
     AND NEW.result_id = OLD.result_id AND NEW.result_seq = OLD.result_seq AND NEW.project_id = OLD.project_id
     AND NEW.catalog_version = OLD.catalog_version AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only (FA Public v1.0): % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV601';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION fa4_project_delivered_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.answers IS DISTINCT FROM OLD.answers
     AND NOT (coalesce(current_setting('fa4.erasure', true), '') = 'on'
              AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                               WHERE r.rolname IN ('beeside_runtime_role', 'beeside_discovery_rw') AND u.rolname = current_user))
     AND EXISTS (SELECT 1 FROM fa4_result x WHERE x.project_id = OLD.project_id AND NOT x.legacy_unsealed) THEN
    RAISE EXCEPTION 'fa4_project %: delivered projects are closed to editing (FA Public v1.0)', OLD.project_id USING ERRCODE = 'BV604';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
