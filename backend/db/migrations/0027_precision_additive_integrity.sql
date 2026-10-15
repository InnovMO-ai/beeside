-- F5 — Precision additive layer, integrity rules the Drizzle DSL cannot express (follows 0019).
-- Source: F1 additive-migrations spec (M-C, M-D, M-F, M-G), prototyped and tested in scratch on PG 16
-- (tests A01–A19) and re-verified in this repository by db/tests/precision/60_additive.sql.

-- ---------------------------------------------------------------------------------------------
-- M-C: context_pin — superseding protocol needs the same-project FK to be DEFERRABLE (supersede
-- the old pin first, then insert the new current pin in the same transaction).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "context_pin" ADD CONSTRAINT "context_pin_superseded_same_project_fk"
  FOREIGN KEY ("superseded_by_pin_id", "project_id") REFERENCES "public"."context_pin"("id", "project_id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE FUNCTION context_pin_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'context_pin rows are never deleted (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'current' OR NEW.superseded_by_pin_id IS NOT NULL THEN
      RAISE EXCEPTION 'a context_pin always starts current' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'current' OR NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'context_pin % may only move current -> superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF (NEW.id, NEW.project_id, NEW.source_system, NEW.source_project_id, NEW.source_result_id, NEW.catalog_version,
      NEW.contract_version, NEW.crosswalk_version, NEW.context_hash, NEW.read_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.project_id, OLD.source_system, OLD.source_project_id, OLD.source_result_id, OLD.catalog_version,
      OLD.contract_version, OLD.crosswalk_version, OLD.context_hash, OLD.read_at, OLD.created_at) THEN
    RAISE EXCEPTION 'context_pin % is immutable except status/superseded_by_pin_id', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.superseded_by_pin_id = OLD.id THEN
    RAISE EXCEPTION 'context_pin % cannot supersede itself', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER context_pin_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON context_pin
  FOR EACH ROW EXECUTE FUNCTION context_pin_guard();--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- M-D: fact origin. fact_guard additionally enforces that source_pin_id belongs to the same project
-- and makes the two new columns immutable; fact_record gains two defaulted arguments (superset
-- signature, existing callers unchanged).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fact_guard() RETURNS TRIGGER AS $$
DECLARE
  v_owning_project_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fact rows are never deleted (fact %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_owning_project_id FROM precision_instance WHERE id = NEW.scope_instance_id;
    IF v_owning_project_id IS NULL OR v_owning_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'fact.project_id must match the owning precision_instance of scope_instance_id % (cross-project scoping violation)', NEW.scope_instance_id USING ERRCODE = 'BV409';
    END IF;
    IF NEW.source_pin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM context_pin WHERE id = NEW.source_pin_id AND project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'fact.source_pin_id must belong to the same project (cross-project scoping violation)' USING ERRCODE = 'BV409';
    END IF;
    IF NEW.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'a fact never starts already superseded' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.scope_instance_id <> OLD.scope_instance_id OR NEW.field_key <> OLD.field_key
     OR NEW.value IS DISTINCT FROM OLD.value OR NEW.value_type <> OLD.value_type OR NEW.answer_state <> OLD.answer_state
     OR NEW.source <> OLD.source OR NEW.provenance_stage <> OLD.provenance_stage
     OR NEW.confidence IS DISTINCT FROM OLD.confidence OR NEW.created_at <> OLD.created_at
     OR NEW.source_pin_id IS DISTINCT FROM OLD.source_pin_id OR NEW.source_item_ref IS DISTINCT FROM OLD.source_item_ref THEN
    RAISE EXCEPTION 'fact % is immutable except for superseded_by, set exactly once', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'fact % is already superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP FUNCTION fact_record(UUID, UUID, TEXT, JSONB, TEXT, fact_answer_state, fact_source, fact_provenance_stage, REAL);--> statement-breakpoint
CREATE FUNCTION fact_record(
  p_project_id UUID, p_scope_instance_id UUID, p_field_key TEXT, p_value JSONB, p_value_type TEXT,
  p_answer_state fact_answer_state, p_source fact_source, p_provenance_stage fact_provenance_stage,
  p_confidence REAL DEFAULT NULL, p_source_pin_id UUID DEFAULT NULL, p_source_item_ref TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_old_id UUID;
  v_new_id UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_old_id FROM fact
    WHERE scope_instance_id = p_scope_instance_id AND field_key = p_field_key AND superseded_by IS NULL
    FOR UPDATE;
  IF v_old_id IS NOT NULL THEN
    UPDATE fact SET superseded_by = v_new_id WHERE id = v_old_id;
  END IF;
  INSERT INTO fact (id, project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage, confidence, source_pin_id, source_item_ref)
  VALUES (v_new_id, p_project_id, p_scope_instance_id, p_field_key, p_value, p_value_type, p_answer_state, p_source, p_provenance_stage, p_confidence, p_source_pin_id, p_source_item_ref);
  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- M-F: oh_delivery — append-only ledger; the artifact must belong to the declared project
-- (pack / service_map_snapshot carry no project_id, so a guard trigger replaces a composite FK).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION oh_delivery_guard() RETURNS TRIGGER AS $$
DECLARE v_owner UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'oh_delivery rows are append-only (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.pack_id IS NOT NULL THEN
    SELECT ca.project_id INTO v_owner FROM pack p JOIN category_assessment ca ON ca.instance_id = p.category_assessment_instance_id WHERE p.id = NEW.pack_id;
  ELSE
    SELECT pi.project_id INTO v_owner FROM service_map_snapshot s JOIN precision_instance pi ON pi.id = s.precision_instance_id WHERE s.id = NEW.snapshot_id;
  END IF;
  IF v_owner IS NULL OR v_owner <> NEW.project_id THEN
    RAISE EXCEPTION 'oh_delivery artifact does not belong to project % (cross-project scoping violation)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER oh_delivery_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON oh_delivery
  FOR EACH ROW EXECUTE FUNCTION oh_delivery_guard();--> statement-breakpoint
CREATE VIEW oh_delivery_current AS
  SELECT DISTINCT ON (idempotency_key) * FROM oh_delivery ORDER BY idempotency_key, seq DESC;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- M-G: "Add a Service" — new service-map version, serialised per project and idempotent per request.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION precision_psm_new_version(p_pa_instance_id UUID, p_client_request_id TEXT, p_content JSONB) RETURNS UUID AS $$
DECLARE
  v_project UUID;
  v_status pa_status;
  v_existing UUID;
  v_id UUID;
BEGIN
  SELECT project_id INTO v_project FROM precision_instance WHERE id = p_pa_instance_id AND scope = 'project';
  IF v_project IS NULL THEN RAISE EXCEPTION 'precision_assessment % not found', p_pa_instance_id USING ERRCODE = 'BV404'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('psm:' || v_project::text, 0));
  SELECT id INTO v_existing FROM service_map_snapshot
    WHERE precision_instance_id = p_pa_instance_id AND content->>'client_request_id' = p_client_request_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT lifecycle_status INTO v_status FROM precision_assessment WHERE instance_id = p_pa_instance_id FOR UPDATE;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Add a Service requires a confirmed Project Service Map (currently %)', v_status USING ERRCODE = 'BV409';
  END IF;
  UPDATE precision_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = p_pa_instance_id;
  UPDATE precision_assessment SET lifecycle_status = 'ready_for_confirmation' WHERE instance_id = p_pa_instance_id;
  v_id := precision_assessment_confirm(p_pa_instance_id, p_content || jsonb_build_object('client_request_id', p_client_request_id));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Least privilege for the application role (second line of defence behind the guard triggers).
-- ---------------------------------------------------------------------------------------------
REVOKE UPDATE ON "oh_delivery" FROM beeside_runtime_role;--> statement-breakpoint
REVOKE UPDATE ON "context_pin" FROM beeside_runtime_role;--> statement-breakpoint
GRANT UPDATE ("status", "superseded_by_pin_id") ON "context_pin" TO beeside_runtime_role;
