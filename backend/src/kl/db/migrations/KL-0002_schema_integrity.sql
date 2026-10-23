-- KL-0002 · Integridad del esquema §5: transiciones de estado, inmutabilidad de contenido, doble intervención
-- (aprobar lo propio rechazado en la base, aun con roles acumulados) y reglas de fuentes comerciales.

-- ---------------------------------------------------------------------------------------------------------------
-- Máquinas de estado (Design Spec §6) como datos inmutables
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.state_transition (
  entity      text NOT NULL,
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (entity, from_status, to_status)
);

SELECT kl.mutation_on();
INSERT INTO kl.state_transition (entity, from_status, to_status) VALUES
  -- 6.1 versión de unidad
  ('unit_version', 'draft', 'in_review'), ('unit_version', 'draft', 'published'), ('unit_version', 'draft', 'withdrawn'),
  ('unit_version', 'in_review', 'published'), ('unit_version', 'in_review', 'awaiting_validation'), ('unit_version', 'in_review', 'rejected'), ('unit_version', 'in_review', 'withdrawn'),
  ('unit_version', 'awaiting_validation', 'published'), ('unit_version', 'awaiting_validation', 'rejected'), ('unit_version', 'awaiting_validation', 'withdrawn'),
  ('unit_version', 'published', 'superseded'), ('unit_version', 'published', 'expired'), ('unit_version', 'published', 'withdrawn'),
  -- 6.2 carga
  ('ingest_batch', 'received', 'rejected'), ('ingest_batch', 'received', 'awaiting_source'), ('ingest_batch', 'awaiting_source', 'received'),
  ('ingest_batch', 'received', 'extracted'), ('ingest_batch', 'extracted', 'in_review'), ('ingest_batch', 'in_review', 'approved'),
  ('ingest_batch', 'in_review', 'rejected'), ('ingest_batch', 'in_review', 'received'), ('ingest_batch', 'approved', 'published'),
  ('ingest_batch', 'published', 'superseded'), ('ingest_batch', 'published', 'withdrawn'),
  -- 6.3 edición de producto
  ('edition', 'composing', 'in_approval'), ('edition', 'in_approval', 'composing'), ('edition', 'in_approval', 'rendering'), ('edition', 'rendering', 'published'),
  ('edition', 'published', 'superseded'), ('edition', 'published', 'unpublished'), ('edition', 'published', 'revoked'),
  -- 6.4 fuente
  ('publication', 'proposed', 'approved'), ('publication', 'proposed', 'rejected'), ('publication', 'approved', 'suspended'), ('publication', 'suspended', 'approved'),
  ('publication', 'approved', 'revoked'), ('publication', 'suspended', 'revoked'), ('publication', 'blocked_pending_verification', 'approved'), ('publication', 'approved', 'discontinued'),
  -- 6.5 demanda y paquete de RAM
  ('demand_group', 'open', 'decided'), ('demand_group', 'decided', 'incorporating'), ('demand_group', 'incorporating', 'closed'),
  ('demand_group', 'decided', 'closed'), ('demand_group', 'decided', 'open'), ('demand_group', 'open', 'closed'),
  ('context_package', 'compiling', 'active'), ('context_package', 'compiling', 'invalidated'), ('context_package', 'active', 'invalidated'), ('context_package', 'active', 'retired');
SELECT kl.mutation_off();

CREATE FUNCTION kl.guard_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (SELECT 1 FROM kl.state_transition WHERE entity = TG_ARGV[0] AND from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'kl.%: transición % → % no permitida', TG_ARGV[0], OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END $$;

-- Solo las columnas indicadas (argumentos del trigger) pueden cambiar; todo lo demás es inmutable.
CREATE FUNCTION kl.guard_mutable_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
    RAISE EXCEPTION 'kl.%: solo pueden cambiar % (contenido inmutable)', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ') USING ERRCODE = 'BV601';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.unit_version FOR EACH ROW EXECUTE FUNCTION kl.guard_status('unit_version');
CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.ingest_batch FOR EACH ROW EXECUTE FUNCTION kl.guard_status('ingest_batch');
CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.edition FOR EACH ROW EXECUTE FUNCTION kl.guard_status('edition');
CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.publication FOR EACH ROW EXECUTE FUNCTION kl.guard_status('publication');
CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.demand_group FOR EACH ROW EXECUTE FUNCTION kl.guard_status('demand_group');
CREATE TRIGGER kl_b_status BEFORE UPDATE ON kl.context_package FOR EACH ROW EXECUTE FUNCTION kl.guard_status('context_package');

-- Columnas mutables por tabla (el resto es de solo lectura una vez insertado).
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.publication FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'next_check_at', 'check_frequency', 'owner_user_id', 'updated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.indicator FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('consumable');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.ingest_batch FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'publication_id', 'reviewed_by', 'approved_by', 'reject_reason', 'updated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.extracted_row FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('indicator_key', 'geo_code', 'classification');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.agent_run FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'finished_at', 'outcome', 'tokens_in', 'tokens_out', 'cost_usd', 'error_code');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.unit FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('product_flag');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.unit_version FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'requires_review', 'review_level', 'approved_by', 'approved_at', 'published_at', 'valid_to', 'next_review_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.card_locale_variant FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('title', 'body', 'claims', 'status', 'reviewed_by', 'approved_at', 'updated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.validator FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.specialist_validation FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.context_package FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'invalidated_reason', 'invalidated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.demand_group FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('signal_count', 'distinct_projects', 'last_seen', 'status', 'updated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.usage_daily FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('count');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.product FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('review_periodicity', 'next_cycle_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.composition_item FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('pinned_version_id', 'sort_order', 'status');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.edition FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'manifest', 'manifest_sha256', 'cutoff_date', 'change_report', 'approved_by', 'published_at', 'superseded_by', 'revocation_reason', 'verification_id_sha256', 'updated_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.change_notice FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('status', 'decided_by', 'decided_at');
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.distribution_daily FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('downloads');

-- Solo inserción (incluso para el dueño).
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.state_transition FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.institution FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.topic FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.publication_config_version FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.source_exception FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.file_object FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.qa_report FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.stat_value FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.card_content FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.unit_link FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.package_member FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.promotion_policy FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.promotion_event FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.demand_signal FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.demand_group_project FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.demand_decision FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.product_section FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.edition_rendering FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.setting_version FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- Reglas de versiones de unidad: doble intervención, contenido presente, validación vigente para nivel 3
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.guard_unit_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE u kl.unit; prev kl.unit_version; v_has_content boolean; v_needs_validation boolean;
BEGIN
  SELECT * INTO u FROM kl.unit WHERE id = NEW.unit_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'kl.unit_version: toda versión nace en draft' USING ERRCODE = 'BV409';
    END IF;
    IF NEW.version = 1 THEN
      IF NEW.supersedes_version_id IS NOT NULL THEN
        RAISE EXCEPTION 'kl.unit_version: la versión 1 no reemplaza a ninguna' USING ERRCODE = 'BV409';
      END IF;
    ELSE
      SELECT * INTO prev FROM kl.unit_version WHERE id = NEW.supersedes_version_id;
      IF NOT FOUND OR prev.unit_id <> NEW.unit_id OR prev.version <> NEW.version - 1 THEN
        RAISE EXCEPTION 'kl.unit_version: la versión % debe reemplazar a la % de la misma unidad', NEW.version, NEW.version - 1 USING ERRCODE = 'BV409';
      END IF;
    END IF;
  END IF;

  -- Doble intervención (Design Spec §7): quien aprueba no puede ser quien redactó, aun con varios roles.
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.authored_by THEN
    RAISE EXCEPTION 'kl.unit_version: quien redacta no puede aprobar su propia versión' USING ERRCODE = 'BV403';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_review' THEN
      SELECT CASE u.kind
               WHEN 'statistic' THEN EXISTS (SELECT 1 FROM kl.stat_value WHERE unit_version_id = NEW.id)
               ELSE EXISTS (SELECT 1 FROM kl.card_content WHERE unit_version_id = NEW.id) END INTO v_has_content;
      IF NOT v_has_content OR NEW.review_level IS NULL THEN
        RAISE EXCEPTION 'kl.unit_version: no se envía a revisión sin contenido ni nivel de revisión' USING ERRCODE = 'BV409';
      END IF;
    ELSIF NEW.status IN ('awaiting_validation', 'published') THEN
      IF NEW.status = 'awaiting_validation' AND NEW.review_level <> 3 THEN
        RAISE EXCEPTION 'kl.unit_version: solo el nivel 3 espera validación especializada' USING ERRCODE = 'BV409';
      END IF;
      IF NEW.status = 'published' THEN
        IF OLD.status = 'draft' AND NOT (NEW.origin = 'collector' AND NEW.review_level = 1) THEN
          RAISE EXCEPTION 'kl.unit_version: solo el recolector publica en automático y solo en nivel 1' USING ERRCODE = 'BV409';
        END IF;
        IF OLD.status = 'in_review' AND NEW.review_level = 3 THEN
          RAISE EXCEPTION 'kl.unit_version: el nivel 3 exige validación especializada antes de publicar' USING ERRCODE = 'BV409';
        END IF;
        v_needs_validation := u.content_risk = 'high' OR NEW.specialist_required OR NEW.review_level = 3;
        IF v_needs_validation AND NOT EXISTS (
          SELECT 1 FROM kl.specialist_validation sv
           WHERE sv.unit_version_id = NEW.id AND sv.content_sha256 = NEW.content_sha256 AND sv.verdict = 'approved' AND sv.status = 'valid' AND sv.expires_at > now()
        ) THEN
          RAISE EXCEPTION 'kl.unit_version: contenido de riesgo alto sin validación especializada vigente sobre esta versión exacta' USING ERRCODE = 'BV409';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT OR UPDATE ON kl.unit_version FOR EACH ROW EXECUTE FUNCTION kl.guard_unit_version();

-- Estadística y ficha: solo sobre versiones draft de su tipo de unidad.
CREATE FUNCTION kl.guard_version_content() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE v_kind text; v_status text;
BEGIN
  SELECT u.kind, uv.status INTO v_kind, v_status FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE uv.id = NEW.unit_version_id;
  IF v_kind IS DISTINCT FROM TG_ARGV[0] OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'kl.%: el contenido solo se agrega a una versión draft de una unidad de tipo %', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT ON kl.stat_value FOR EACH ROW EXECUTE FUNCTION kl.guard_version_content('statistic');
CREATE TRIGGER kl_b_rules BEFORE INSERT ON kl.card_content FOR EACH ROW EXECUTE FUNCTION kl.guard_version_content('card');

-- Variante de idioma: el revisor no es el autor; una variante aprobada ya no cambia.
CREATE FUNCTION kl.guard_card_variant() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE v_author uuid; v_kind text;
BEGIN
  SELECT uv.authored_by, u.kind INTO v_author, v_kind FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE uv.id = NEW.unit_version_id;
  IF v_kind IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION 'kl.card_locale_variant: solo las fichas tienen variantes de idioma' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND NEW.reviewed_by = v_author THEN
    RAISE EXCEPTION 'kl.card_locale_variant: quien redactó la ficha no puede revisar su variante' USING ERRCODE = 'BV403';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND (NEW.title, NEW.body, NEW.claims) IS DISTINCT FROM (OLD.title, OLD.body, OLD.claims) THEN
    RAISE EXCEPTION 'kl.card_locale_variant: una variante aprobada no cambia (si cambia la maestra nace otra versión)' USING ERRCODE = 'BV601';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT OR UPDATE ON kl.card_locale_variant FOR EACH ROW EXECUTE FUNCTION kl.guard_card_variant();

-- Carga: quien sube no aprueba ni revisa su propia carga.
CREATE FUNCTION kl.guard_ingest_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.uploaded_by THEN
    RAISE EXCEPTION 'kl.ingest_batch: quien sube la carga no puede aprobarla' USING ERRCODE = 'BV403';
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND NEW.reviewed_by = NEW.uploaded_by THEN
    RAISE EXCEPTION 'kl.ingest_batch: quien sube la carga no puede revisarla' USING ERRCODE = 'BV403';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT OR UPDATE ON kl.ingest_batch FOR EACH ROW EXECUTE FUNCTION kl.guard_ingest_batch();

-- Validación especializada: huella exacta, dominio del validador y separación de funciones.
CREATE FUNCTION kl.guard_specialist_validation() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE uv kl.unit_version; v kl.validator;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  SELECT * INTO uv FROM kl.unit_version WHERE id = NEW.unit_version_id;
  SELECT * INTO v FROM kl.validator WHERE id = NEW.validator_id;
  IF uv.content_sha256 <> NEW.content_sha256 THEN
    RAISE EXCEPTION 'kl.specialist_validation: la validación debe firmar la huella exacta de la versión' USING ERRCODE = 'BV409';
  END IF;
  IF v.status <> 'active' OR NOT (NEW.domain = ANY (v.domains)) THEN
    RAISE EXCEPTION 'kl.specialist_validation: validador inactivo o fuera de su dominio' USING ERRCODE = 'BV403';
  END IF;
  IF NEW.recorded_by = uv.authored_by THEN
    RAISE EXCEPTION 'kl.specialist_validation: quien registra la validación no puede ser el autor de la versión' USING ERRCODE = 'BV403';
  END IF;
  IF v.kind = 'internal' AND v.admin_user_id = uv.authored_by THEN
    RAISE EXCEPTION 'kl.specialist_validation: el validador no puede ser el autor de la versión' USING ERRCODE = 'BV403';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT ON kl.specialist_validation FOR EACH ROW EXECUTE FUNCTION kl.guard_specialist_validation();

-- Edición: el aprobador editorial no es quien la compuso.
CREATE FUNCTION kl.guard_edition() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.composed_by THEN
    RAISE EXCEPTION 'kl.edition: quien compuso la edición no puede aprobarla' USING ERRCODE = 'BV403';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT OR UPDATE ON kl.edition FOR EACH ROW EXECUTE FUNCTION kl.guard_edition();

-- Fuentes: una institución comercial solo se aprueba con una excepción vigente (A04).
CREATE FUNCTION kl.guard_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE v_kind text;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT kind INTO v_kind FROM kl.institution WHERE id = NEW.institution_id;
    IF v_kind = 'commercial' AND NOT EXISTS (SELECT 1 FROM kl.source_exception WHERE publication_id = NEW.id AND expires_at > now()) THEN
      RAISE EXCEPTION 'kl.publication: una fuente comercial no se aprueba sin una excepción vigente' USING ERRCODE = 'BV409';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'proposed' AND NEW.status <> 'blocked_pending_verification' THEN
    RAISE EXCEPTION 'kl.publication: toda fuente nace propuesta' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT OR UPDATE ON kl.publication FOR EACH ROW EXECUTE FUNCTION kl.guard_publication();

-- Una versión solo entra a un paquete si está publicada.
CREATE FUNCTION kl.guard_package_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kl.unit_version WHERE id = NEW.unit_version_id AND status = 'published') THEN
    RAISE EXCEPTION 'kl.package_member: solo se compila contenido publicado' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_rules BEFORE INSERT ON kl.package_member FOR EACH ROW EXECUTE FUNCTION kl.guard_package_member();

SELECT kl.attach_guards();
