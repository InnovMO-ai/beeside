-- KL-0005 · Integridad y permisos de R3: bloques fijos y términos inmutables, manifiesto congelado desde el render, vistas de
-- administración y de distribución, y permisos de ejecución por rol.

CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.fixed_block FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'approved_by', 'approved_at');
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.catalog_entry FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.private_term FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.edition_preview FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();

-- Desde el render el manifiesto y su huella no cambian jamás (el PDF publicado queda congelado).
CREATE FUNCTION kl.guard_edition_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF OLD.status IN ('rendering', 'published', 'superseded', 'unpublished', 'revoked')
     AND (NEW.manifest IS DISTINCT FROM OLD.manifest OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256 OR NEW.composed_by IS DISTINCT FROM OLD.composed_by)
     AND NOT (OLD.status = 'rendering' AND NEW.status = 'in_approval' AND NEW.manifest IS NOT DISTINCT FROM OLD.manifest) THEN
    RAISE EXCEPTION 'kl.edition: el manifiesto de una edición aprobada o publicada es inmutable' USING ERRCODE = 'BV601';
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'published' AND (NEW.verification_id_sha256 IS DISTINCT FROM OLD.verification_id_sha256 OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'kl.edition: la identidad pública de una edición publicada es inmutable' USING ERRCODE = 'BV601';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_frozen BEFORE UPDATE ON kl.edition FOR EACH ROW EXECUTE FUNCTION kl.guard_edition_frozen();

-- Distribución: solo ediciones PUBLICADAS (nunca vistas previas ni ediciones compuestas o aprobadas).
CREATE VIEW kl.v_edition_file AS
SELECT pr.key || '@' || e.code AS edition_ref, pr.key AS product_key, er.locale, fo.storage_key, er.pdf_sha256, fo.byte_length,
       pr.key || '-' || e.code || '-' || er.locale || '.pdf' AS filename
  FROM kl.edition e JOIN kl.product pr ON pr.id = e.product_id JOIN kl.edition_rendering er ON er.edition_id = e.id JOIN kl.file_object fo ON fo.id = er.file_object_id
 WHERE e.status = 'published' AND fo.purpose = 'edition_pdf';

CREATE VIEW kl.v_admin_editions AS
SELECT e.id, pr.key AS product_key, e.code, e.status, e.composed_by, e.approved_by, e.cutoff_date, e.manifest_sha256, e.published_at, e.revocation_reason,
       (SELECT count(*)::int FROM kl.edition_rendering er WHERE er.edition_id = e.id) AS renderings
  FROM kl.edition e JOIN kl.product pr ON pr.id = e.product_id WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_composition AS
SELECT pr.key AS product_key, ps.section_key, ps.chapter, ps.content_type, u.unit_key, ci.status, uv.version AS pinned_version
  FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id JOIN kl.product pr ON pr.id = ps.product_id JOIN kl.unit u ON u.id = ci.unit_id
  LEFT JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_change_notices AS
SELECT n.id, pr.key AS product_key, u.unit_key, n.kind, n.status, n.decided_by, n.created_at, n.decided_at
  FROM kl.change_notice n JOIN kl.product pr ON pr.id = n.product_id JOIN kl.unit u ON u.id = n.unit_id WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_fixed_blocks AS
SELECT id, block_id, version, locale, status, content_sha256, authored_by, approved_by FROM kl.fixed_block WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_edition_previews AS
SELECT p.id, p.edition_id, p.locale, p.manifest_sha256, p.created_at FROM kl.edition_preview p WHERE (SELECT kl.can_read());

REVOKE ALL ON FUNCTION kl._fold(text), kl._refresh_pins(uuid), kl._edition_controls(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  kl.register_catalog_entries(text, text, text[]), kl.add_private_term(text, text), kl.set_product_config(text, jsonb), kl.register_fixed_block(text, text, text, jsonb),
  kl.approve_fixed_block(uuid), kl.add_product_section(text, text, text, text, text, integer, text, text, text, text[], text), kl.compose_unit(text, text, text, integer),
  kl.decide_change_notice(uuid, text, text), kl.open_edition(text, text, date), kl.refresh_pins(uuid), kl.submit_edition(uuid, jsonb), kl.return_edition_to_composing(uuid, text),
  kl.approve_edition(uuid), kl.request_preview(uuid), kl.unpublish_edition(uuid, text), kl.revoke_edition(uuid, text), kl.edition_controls(uuid),
  kl.manifest_inputs(uuid), kl.preview_file(uuid, text)
TO kl_app;
GRANT EXECUTE ON FUNCTION kl.edition_snapshot(uuid), kl.complete_rendering(uuid, text, jsonb), kl.fail_rendering(uuid, text), kl.complete_preview(uuid, text, text, bigint, text), kl.triage_stale_jobs() TO kl_knowledge;
GRANT SELECT ON kl.v_edition_file TO kl_reader_precision;
GRANT SELECT ON kl.v_admin_editions, kl.v_admin_composition, kl.v_admin_change_notices, kl.v_admin_fixed_blocks, kl.v_admin_edition_previews TO kl_app;

SELECT kl.attach_guards();
