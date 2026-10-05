-- Custom SQL migration: FA Public v1.0 integrity rules (module fa4).
--  * Delivered results are append-only and keep their catalog version (D-117): no UPDATE / DELETE.
--  * Published catalog versions are immutable (CATALOG_MODEL §5): no UPDATE / DELETE.
--  * Catalog change history is append-only (who, when, previous state, new state).
--  * Catalog ids are never reused: a catalog entity cannot be deleted (ARCHIVED is the end state, D-094).
--  * A delivered result must reference an existing PUBLISHED catalog version (FK) — a result without a version cannot exist.

CREATE FUNCTION fa4_append_only_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (FA Public v1.0): % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV601';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Delivered results are append-only EXCEPT for one authorized path: fa4_anonymize_project() may replace `model` (the only column
-- that carries personal data) when it runs as the migration/owner role inside its own transaction. The bypass is a transaction-local
-- setting that only counts when the caller is NOT a member of beeside_runtime_role, so the application cannot enable it.
CREATE FUNCTION fa4_result_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND coalesce(current_setting('fa4.erasure', true), '') = 'on'
     AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                      WHERE r.rolname = 'beeside_runtime_role' AND u.rolname = current_user)
     AND NEW.result_id = OLD.result_id AND NEW.result_seq = OLD.result_seq AND NEW.project_id = OLD.project_id
     AND NEW.catalog_version = OLD.catalog_version AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only (FA Public v1.0): % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV601';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER fa4_result_append_only BEFORE UPDATE OR DELETE ON fa4_result
  FOR EACH ROW EXECUTE FUNCTION fa4_result_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_legal_acceptance_append_only BEFORE UPDATE OR DELETE ON fa4_legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_privacy_erasure_log_append_only BEFORE UPDATE OR DELETE ON fa4_privacy_erasure_log
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
-- TRUNCATE bypasses row triggers, so append-only tables also refuse it.
CREATE TRIGGER fa4_result_no_truncate BEFORE TRUNCATE ON fa4_result FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_version_no_truncate BEFORE TRUNCATE ON fa4_catalog_version FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_change_no_truncate BEFORE TRUNCATE ON fa4_catalog_change FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_legal_acceptance_no_truncate BEFORE TRUNCATE ON fa4_legal_acceptance FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_privacy_erasure_log_no_truncate BEFORE TRUNCATE ON fa4_privacy_erasure_log FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_version_append_only BEFORE UPDATE OR DELETE ON fa4_catalog_version
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_change_append_only BEFORE UPDATE OR DELETE ON fa4_catalog_change
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint

CREATE FUNCTION fa4_catalog_entity_no_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'catalog ids are never reused or deleted: archive % % instead', OLD.entity_type, OLD.entity_id USING ERRCODE = 'BV602';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_entity_no_delete BEFORE DELETE ON fa4_catalog_entity
  FOR EACH ROW EXECUTE FUNCTION fa4_catalog_entity_no_delete();
--> statement-breakpoint

-- An ARCHIVED entity can never be re-activated under the same id with a different meaning: only ARCHIVED -> ARCHIVED updates.
CREATE FUNCTION fa4_catalog_entity_archived_final() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.publication_status = 'ARCHIVED' AND NEW.publication_status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'ARCHIVED catalog ids are never reused: % %', OLD.entity_type, OLD.entity_id USING ERRCODE = 'BV602';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fa4_catalog_entity_archived_final BEFORE UPDATE ON fa4_catalog_entity
  FOR EACH ROW EXECUTE FUNCTION fa4_catalog_entity_archived_final();

--> statement-breakpoint

-- Least privilege: the runtime role has no UPDATE on append-only tables (the triggers above are the second line of defence).
REVOKE UPDATE ON fa4_result, fa4_catalog_version, fa4_catalog_change, fa4_legal_acceptance, fa4_privacy_erasure_log FROM beeside_runtime_role;
--> statement-breakpoint

-- M3 — authorized irreversible anonymization (privacy erasure / retention). NOT scheduled and NOT granted to the application:
-- a data-protection operator runs it manually as the migration/owner role, e.g.
--   SELECT fa4_anonymize_project('<project uuid>', 'dpo@example.org', 'data-subject request ref 123');
-- The retention period is a business/legal decision (not defined in this release); an automatic purge must call this function
-- from an operator-owned job once that period is approved. It removes personal data and keeps non-personal structure (project id,
-- catalog version, signal class/capability, legal-acceptance evidence) so append-only history and sourcing work stay consistent.
CREATE FUNCTION fa4_anonymize_project(p_project uuid, p_actor text, p_reason text) RETURNS void AS $$
BEGIN
  IF coalesce(btrim(p_actor), '') = '' OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'actor and reason are required for a privacy erasure' USING ERRCODE = 'BV603';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fa4_project WHERE project_id = p_project) THEN
    RAISE EXCEPTION 'unknown FA project' USING ERRCODE = 'BV603';
  END IF;
  PERFORM set_config('fa4.erasure', 'on', true);
  UPDATE fa4_result SET model = jsonb_build_object('anonymized', true) WHERE project_id = p_project;
  PERFORM set_config('fa4.erasure', 'off', true);
  UPDATE fa4_demand_signal SET payload = jsonb_build_object('anonymized', true), updated_at = now() WHERE project_id = p_project;
  UPDATE fa4_access_token SET revoked_at = coalesce(revoked_at, now()) WHERE project_id = p_project;
  UPDATE fa4_project SET email = 'anonymized+' || p_project::text || '@invalid.invalid', answers = '{}'::jsonb, status = 'ANONYMIZED', updated_at = now()
    WHERE project_id = p_project;
  INSERT INTO fa4_privacy_erasure_log (project_id, mode, actor, reason) VALUES (p_project, 'ANONYMIZE', p_actor, p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fa4_anonymize_project(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fa4_anonymize_project(uuid, text, text) FROM beeside_runtime_role;
