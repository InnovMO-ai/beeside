-- Custom SQL migration (Public v1.0): integrity of the DELIVERED state and of the sealed envelope (D-156 / D-157 / D-159).
--  * after an explicit delivery the project's answers are closed to editing IN THE DATABASE (not only in the API);
--  * impossible states are impossible: a project can be DELIVERED only with a sealed result, and a sealed result can only exist for a delivered project
--    (deferred constraint triggers, checked at COMMIT so both rows can be written in one transaction);
--  * a Premium continuation can only point at a sealed (delivered) result — a preview or legacy row is never eligible;
--  * authorized erasure (fa4_anonymize_project) now also scrubs the new snapshots.

CREATE FUNCTION fa4_project_delivered_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.answers IS DISTINCT FROM OLD.answers
     AND NOT (coalesce(current_setting('fa4.erasure', true), '') = 'on'
              AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                               WHERE r.rolname = 'beeside_runtime_role' AND u.rolname = current_user))
     AND EXISTS (SELECT 1 FROM fa4_result x WHERE x.project_id = OLD.project_id AND NOT x.legacy_unsealed) THEN
    RAISE EXCEPTION 'fa4_project %: delivered projects are closed to editing (FA Public v1.0)', OLD.project_id USING ERRCODE = 'BV604';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fa4_project_delivered_lock BEFORE UPDATE OF answers ON fa4_project
  FOR EACH ROW EXECUTE FUNCTION fa4_project_delivered_guard();
--> statement-breakpoint

CREATE FUNCTION fa4_delivery_consistency() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'fa4_project' THEN
    IF NEW.status = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM fa4_result x WHERE x.project_id = NEW.project_id AND NOT x.legacy_unsealed) THEN
      RAISE EXCEPTION 'fa4_project %: DELIVERED requires a sealed result', NEW.project_id USING ERRCODE = 'BV605';
    END IF;
  ELSIF NOT NEW.legacy_unsealed AND NOT EXISTS (SELECT 1 FROM fa4_project p WHERE p.project_id = NEW.project_id AND p.status IN ('DELIVERED', 'ANONYMIZED')) THEN
    RAISE EXCEPTION 'fa4_result %: a sealed result requires its project to be DELIVERED', NEW.result_id USING ERRCODE = 'BV605';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fa4_project_delivered_consistency AFTER INSERT OR UPDATE OF status ON fa4_project
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fa4_delivery_consistency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fa4_result_delivered_consistency AFTER INSERT ON fa4_result
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fa4_delivery_consistency();
--> statement-breakpoint

CREATE FUNCTION fa4_continuation_requires_sealed() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fa4_result x WHERE x.result_id = NEW.result_id AND x.project_id = NEW.project_id AND NOT x.legacy_unsealed) THEN
    RAISE EXCEPTION 'fa4_continuation_request: only a delivered (sealed) result can be continued' USING ERRCODE = 'BV606';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fa4_continuation_sealed_only BEFORE INSERT ON fa4_continuation_request
  FOR EACH ROW EXECUTE FUNCTION fa4_continuation_requires_sealed();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION fa4_anonymize_project(p_project uuid, p_actor text, p_reason text) RETURNS void AS $$
BEGIN
  IF coalesce(btrim(p_actor), '') = '' OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'actor and reason are required for a privacy erasure' USING ERRCODE = 'BV603';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fa4_project WHERE project_id = p_project) THEN
    RAISE EXCEPTION 'unknown FA project' USING ERRCODE = 'BV603';
  END IF;
  PERFORM set_config('fa4.erasure', 'on', true);
  -- every stored copy of client data: the YEV model, the source facts and the resolution projection (texts of the client live in both)
  UPDATE fa4_result SET model = jsonb_build_object('anonymized', true),
                        source_snapshot = CASE WHEN source_snapshot IS NULL THEN NULL ELSE jsonb_build_object('anonymized', true) END,
                        resolution_snapshot = CASE WHEN resolution_snapshot IS NULL THEN NULL ELSE jsonb_build_object('anonymized', true) END
    WHERE project_id = p_project;
  UPDATE fa4_demand_signal SET payload = jsonb_build_object('anonymized', true), updated_at = now() WHERE project_id = p_project;
  UPDATE fa4_contact_request SET name = 'anonymized', company = 'anonymized', email = 'anonymized+' || contact_id::text || '@invalid.invalid', message = 'anonymized' WHERE project_id = p_project;
  UPDATE fa4_access_token SET revoked_at = coalesce(revoked_at, now()) WHERE project_id = p_project;
  UPDATE fa4_project SET email = 'anonymized+' || p_project::text || '@invalid.invalid', answers = '{}'::jsonb, status = 'ANONYMIZED', updated_at = now()
    WHERE project_id = p_project;
  PERFORM set_config('fa4.erasure', 'off', true);
  INSERT INTO fa4_privacy_erasure_log (project_id, mode, actor, reason) VALUES (p_project, 'ANONYMIZE', p_actor, p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
