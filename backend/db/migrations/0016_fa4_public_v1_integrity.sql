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

CREATE TRIGGER fa4_result_append_only BEFORE UPDATE OR DELETE ON fa4_result
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
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
