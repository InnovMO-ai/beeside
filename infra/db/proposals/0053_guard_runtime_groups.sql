-- PROPOSAL, NOT PART OF THE MIGRATION LINEAGE, NOT APPLIED ANYWHERE. Found by the strengthened privacy rehearsal (finding F1).
--
-- Problem: the erasure bypass guards (fa4_result_guard 0016, fa4_project_delivered_guard 0023) accept the transaction-local flag fa4.erasure='on' from any role that is NOT a
-- direct member of beeside_runtime_role. In the legacy database the Discovery application login (discovery_runtime) IS a member, so the application cannot open the bypass.
-- In the canonical database the Discovery login (beeside_discovery_runtime) belongs to beeside_discovery_rw and NOT to beeside_runtime_role (that is the point of the domain
-- separation), so the guard treats it as an operator: a session of the Discovery application can run  set_config('fa4.erasure','on',true)  and rewrite `answers` of a DELIVERED
-- project (it has UPDATE on fa4_project). fa4_result stays protected only by the missing UPDATE privilege. Reproduced on the simulator and by rehearse-on-clone.sh (S4).
--
-- Fix: both guards deny the bypass to a direct member of EITHER runtime group. Operators (the migration owner, SECURITY DEFINER fa4_anonymize_project) are in neither.
-- Bodies are the 0016 / 0023 bodies with ONE changed predicate. Idempotent (CREATE OR REPLACE); no data change; rollback = re-create the previous bodies.
-- Adopting it means a new migration in the shared lineage (renumber, mirror in Discovery, update the pinned counts): a Product Owner decision.

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
