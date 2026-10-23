-- Custom SQL migration (Presentation RC).
--  * fa4_event is append-only (no UPDATE / DELETE / TRUNCATE for anyone; the runtime role cannot even UPDATE it). It holds no personal data.
--  * fa4_contact_request carries personal data: fa4_anonymize_project() now scrubs it too.
--  * a pending contact delivery must always point at its request.
CREATE TRIGGER fa4_event_append_only BEFORE UPDATE OR DELETE ON fa4_event
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_event_no_truncate BEFORE TRUNCATE ON fa4_event
  FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
REVOKE UPDATE ON fa4_event FROM beeside_runtime_role;
--> statement-breakpoint
ALTER TABLE fa4_email_delivery ADD CONSTRAINT fa4_email_delivery_contact_ref
  CHECK ((template = 'fa4_contact_request') = (contact_request_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE fa4_email_delivery ADD CONSTRAINT fa4_email_delivery_project_ref
  CHECK (template = 'fa4_contact_request' OR project_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE fa4_email_delivery ADD CONSTRAINT fa4_email_delivery_contact_fk
  FOREIGN KEY (contact_request_id) REFERENCES fa4_contact_request(contact_id);
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
  UPDATE fa4_result SET model = jsonb_build_object('anonymized', true) WHERE project_id = p_project;
  PERFORM set_config('fa4.erasure', 'off', true);
  UPDATE fa4_demand_signal SET payload = jsonb_build_object('anonymized', true), updated_at = now() WHERE project_id = p_project;
  UPDATE fa4_contact_request SET name = 'anonymized', company = 'anonymized', email = 'anonymized+' || contact_id::text || '@invalid.invalid', message = 'anonymized' WHERE project_id = p_project;
  UPDATE fa4_access_token SET revoked_at = coalesce(revoked_at, now()) WHERE project_id = p_project;
  UPDATE fa4_project SET email = 'anonymized+' || p_project::text || '@invalid.invalid', answers = '{}'::jsonb, status = 'ANONYMIZED', updated_at = now()
    WHERE project_id = p_project;
  INSERT INTO fa4_privacy_erasure_log (project_id, mode, actor, reason) VALUES (p_project, 'ANONYMIZE', p_actor, p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
