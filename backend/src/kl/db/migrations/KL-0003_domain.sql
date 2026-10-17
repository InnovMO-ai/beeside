-- KL-0003 · Funciones de dominio de R1 (I2 repositorio, I5 paquetes, I6 compuerta de afirmaciones, I7 señales,
-- I8 canal de carga). Toda mutación pasa por una función que llama primero a kl.begin_mutation (kl.require); las
-- tablas no conceden DML a ningún rol de aplicación (CR-KL-002 §3). Las funciones privadas (prefijo _) no tienen
-- permisos de ejecución: solo las invocan otras funciones del dueño.

CREATE TABLE kl.signal_discard_daily (
  day               date PRIMARY KEY,
  fields_discarded  bigint NOT NULL DEFAULT 0 CHECK (fields_discarded >= 0),
  signals_rejected  bigint NOT NULL DEFAULT 0 CHECK (signals_rejected >= 0)
);
CREATE TRIGGER kl_b_mutable BEFORE UPDATE ON kl.signal_discard_daily FOR EACH ROW EXECUTE FUNCTION kl.guard_mutable_only('fields_discarded', 'signals_rejected');

CREATE FUNCTION kl._text_array(p_json jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = kl, pg_temp AS $$
  SELECT CASE WHEN p_json IS NULL OR jsonb_typeof(p_json) <> 'array' THEN '{}'::text[] ELSE ARRAY(SELECT jsonb_array_elements_text(p_json)) END;
$$;

CREATE FUNCTION kl._setting(p_key text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = kl, pg_temp AS $$
  SELECT value FROM kl.setting_version WHERE key = p_key ORDER BY version DESC LIMIT 1;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Efectos compartidos: retiro, invalidación de paquetes y publicación
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl._invalidate_packages(p_version_ids uuid[], p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE kl.context_package cp SET status = 'invalidated', invalidated_reason = left(p_reason, 300), invalidated_at = now()
   WHERE cp.status = 'active' AND cp.id IN (SELECT package_id FROM kl.package_member WHERE unit_version_id = ANY (p_version_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION kl._withdraw_versions(p_version_ids uuid[], p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE kl.unit_version SET status = 'withdrawn' WHERE id = ANY (p_version_ids) AND status IN ('draft', 'in_review', 'awaiting_validation', 'published');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM kl._invalidate_packages(p_version_ids, p_reason);
  -- Los productos que citan la unidad reciben un aviso de cambio; nada se reescribe (AC-07).
  INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, kind)
  SELECT DISTINCT ps.product_id, uv.unit_id, uv.id, 'withdrawn'
    FROM kl.composition_item ci
    JOIN kl.product_section ps ON ps.id = ci.section_id
    JOIN kl.unit_version uv ON uv.unit_id = ci.unit_id
   WHERE uv.id = ANY (p_version_ids) AND uv.status = 'withdrawn';
  RETURN n;
END $$;

-- Publica la versión: la publicada anterior de la unidad queda superseded y los paquetes que la contenían se invalidan.
CREATE FUNCTION kl._publish_version(p_version_id uuid, p_approver uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v kl.unit_version; old_ids uuid[];
BEGIN
  SELECT * INTO v FROM kl.unit_version WHERE id = p_version_id FOR UPDATE;
  SELECT array_agg(id) INTO old_ids FROM kl.unit_version WHERE unit_id = v.unit_id AND status = 'published' AND id <> v.id;
  IF old_ids IS NOT NULL THEN
    UPDATE kl.unit_version SET status = 'superseded' WHERE id = ANY (old_ids);
    PERFORM kl._invalidate_packages(old_ids, 'superseded by ' || v.id::text);
  END IF;
  UPDATE kl.unit_version SET status = 'published', approved_by = coalesce(approved_by, p_approver), approved_at = coalesce(approved_at, now()), published_at = now() WHERE id = p_version_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fuentes e indicadores
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.propose_institution(p_key text, p_name text, p_country text, p_authority_class text, p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM kl.begin_mutation('source.propose');
  INSERT INTO kl.institution (key, name, country, authority_class, kind) VALUES (p_key, p_name, p_country, p_authority_class, p_kind) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.institution.propose', 'institution', v_id::text, NULL, NULL, p_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.propose_publication(p_key text, p_institution_key text, p_title text, p_jurisdiction text, p_topics text[], p_official_url text,
  p_permitted_use text, p_default_content_risk text, p_matrix_code text DEFAULT NULL, p_edition_pattern text DEFAULT NULL, p_license_text text DEFAULT NULL,
  p_expected_periodicity text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_inst uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('source.propose');
  SELECT id INTO v_inst FROM kl.institution WHERE key = p_institution_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: institución inexistente' USING ERRCODE = 'BV404'; END IF;
  INSERT INTO kl.publication (key, institution_id, title, jurisdiction, topics, official_url, edition_pattern, license_text, permitted_use, default_content_risk, expected_periodicity, matrix_code, owner_user_id)
  VALUES (p_key, v_inst, p_title, p_jurisdiction, coalesce(p_topics, '{}'), p_official_url, p_edition_pattern, p_license_text, p_permitted_use, p_default_content_risk, p_expected_periodicity, p_matrix_code, v_actor)
  RETURNING id INTO v_id;
  PERFORM kl.audit('kl.publication.propose', 'publication', v_id::text, NULL, 'proposed', p_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.register_indicator(p_key text, p_name_es text, p_name_en text, p_unit text, p_direction text, p_nature text, p_publication_key text, p_consumable boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_id uuid; v_pub uuid;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  IF p_publication_key IS NOT NULL THEN
    SELECT id INTO v_pub FROM kl.publication WHERE key = p_publication_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'BV404: publicación inexistente' USING ERRCODE = 'BV404'; END IF;
  END IF;
  INSERT INTO kl.indicator (key, name_es, name_en, unit, direction, nature, primary_publication_id, consumable)
  VALUES (p_key, p_name_es, p_name_en, p_unit, p_direction, p_nature, v_pub, coalesce(p_consumable, false)) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.indicator.register', 'indicator', v_id::text, NULL, NULL, p_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Aprobar, suspender, reanudar, rechazar, revocar o descontinuar una fuente (solo KL_ADMIN). La revocación es una
-- sola transacción (A10): unidades withdrawn, cargas withdrawn, paquetes invalidados; la historia queda intacta.
CREATE FUNCTION kl.decide_publication(p_key text, p_decision text, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; pub kl.publication; v_to text; v_ids uuid[];
BEGIN
  v_actor := kl.begin_mutation('source.decide');
  SELECT * INTO pub FROM kl.publication WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: publicación inexistente' USING ERRCODE = 'BV404'; END IF;
  v_to := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'resume' THEN 'approved' WHEN 'suspend' THEN 'suspended' WHEN 'reject' THEN 'rejected'
                          WHEN 'revoke' THEN 'revoked' WHEN 'discontinue' THEN 'discontinued' END;
  IF v_to IS NULL THEN RAISE EXCEPTION 'BV422: decisión no válida' USING ERRCODE = 'BV422'; END IF;
  UPDATE kl.publication SET status = v_to, updated_at = now() WHERE id = pub.id;
  IF v_to = 'revoked' THEN
    SELECT array_agg(DISTINCT uv.id) INTO v_ids
      FROM kl.unit_version uv
     WHERE uv.status IN ('draft', 'in_review', 'awaiting_validation', 'published')
       AND (EXISTS (SELECT 1 FROM kl.stat_value sv WHERE sv.unit_version_id = uv.id AND sv.publication_id = pub.id)
         OR EXISTS (SELECT 1 FROM kl.card_content cc WHERE cc.unit_version_id = uv.id AND cc.primary_source_publication_id = pub.id)
         OR EXISTS (SELECT 1 FROM kl.ingest_batch b WHERE b.id = uv.batch_id AND b.publication_id = pub.id));
    IF v_ids IS NOT NULL THEN PERFORM kl._withdraw_versions(v_ids, 'source revoked: ' || p_key); END IF;
    UPDATE kl.ingest_batch SET status = 'withdrawn', updated_at = now() WHERE publication_id = pub.id AND status = 'published';
  END IF;
  PERFORM kl.audit('kl.publication.' || p_decision, 'publication', pub.id::text, pub.status, v_to, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_to;
END $$;

CREATE FUNCTION kl.add_source_exception(p_publication_key text, p_scope text, p_jurisdiction text, p_permitted_use text, p_expires_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_pub uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('source.decide');
  SELECT id INTO v_pub FROM kl.publication WHERE key = p_publication_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: publicación inexistente' USING ERRCODE = 'BV404'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RAISE EXCEPTION 'BV422: la excepción debe vencer en el futuro' USING ERRCODE = 'BV422'; END IF;
  INSERT INTO kl.source_exception (publication_id, scope, jurisdiction, permitted_use, expires_at, approved_by)
  VALUES (v_pub, p_scope, p_jurisdiction, p_permitted_use, p_expires_at, v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.source_exception.add', 'source_exception', v_id::text, NULL, NULL, p_scope);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Repositorio (I2): unidades y versiones
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.create_unit(p_unit_key text, p_kind text, p_country text, p_region text, p_topic_key text, p_category_keys text[], p_service_ids text[],
  p_industry_keys text[], p_catalog_version text, p_content_risk text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  INSERT INTO kl.unit (unit_key, kind, country, region, topic_key, category_keys, service_ids, industry_keys, catalog_version, content_risk)
  VALUES (p_unit_key, p_kind, p_country, p_region, p_topic_key, coalesce(p_category_keys, '{}'), coalesce(p_service_ids, '{}'), coalesce(p_industry_keys, '{}'), p_catalog_version, p_content_risk)
  RETURNING id INTO v_id;
  PERFORM kl.audit('kl.unit.create', 'unit', v_id::text, NULL, NULL, p_unit_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Nueva versión (corrección) de una unidad existente; un periodo nuevo es otra unidad. El contenido es inmutable y su
-- huella (content_sha256) firma la versión exacta.
CREATE FUNCTION kl.create_version(p_unit_key text, p_origin text, p_batch_id uuid, p_change_class text, p_permitted_use text, p_limits_es text[], p_limits_en text[],
  p_valid_from timestamptz, p_valid_to timestamptz, p_next_review_at timestamptz, p_specialist_required boolean, p_specialist_category_key text,
  p_content jsonb, p_variant_en jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; u kl.unit; v_next integer; v_prev uuid; v_sha text; v_id uuid; v_pub uuid; v_primary uuid; v_canon jsonb;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  SELECT * INTO u FROM kl.unit WHERE unit_key = p_unit_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: unidad inexistente' USING ERRCODE = 'BV404'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.unit_version WHERE unit_id = u.id;
  SELECT id INTO v_prev FROM kl.unit_version WHERE unit_id = u.id ORDER BY version DESC LIMIT 1;
  v_canon := jsonb_build_object('unit_key', p_unit_key, 'version', v_next, 'kind', u.kind, 'content', p_content, 'variant_en', p_variant_en,
                                'limits_es', to_jsonb(coalesce(p_limits_es, '{}'::text[])), 'limits_en', to_jsonb(coalesce(p_limits_en, '{}'::text[])), 'permitted_use', p_permitted_use);
  v_sha := encode(sha256(convert_to(v_canon::text, 'UTF8')), 'hex');
  INSERT INTO kl.unit_version (unit_id, version, supersedes_version_id, change_class, origin, batch_id, valid_from, valid_to, next_review_at, permitted_use,
                               limits_es, limits_en, specialist_required, specialist_category_key, authored_by, content_sha256)
  VALUES (u.id, v_next, v_prev, p_change_class, p_origin, p_batch_id, coalesce(p_valid_from, now()), p_valid_to, p_next_review_at, p_permitted_use,
          coalesce(p_limits_es, '{}'), coalesce(p_limits_en, '{}'), coalesce(p_specialist_required, false), p_specialist_category_key, v_actor, v_sha)
  RETURNING id INTO v_id;

  IF u.kind = 'statistic' THEN
    SELECT id INTO v_pub FROM kl.publication WHERE key = p_content->>'publication_key';
    IF v_pub IS NULL THEN RAISE EXCEPTION 'BV404: publicación de la estadística inexistente' USING ERRCODE = 'BV404'; END IF;
    IF p_content ? 'primary_ref' THEN
      SELECT uv.id INTO v_primary FROM kl.unit_version uv JOIN kl.unit pu ON pu.id = uv.unit_id
       WHERE pu.unit_key = split_part(p_content->>'primary_ref', '@', 1) AND uv.version = split_part(p_content->>'primary_ref', '@', 2)::integer;
    END IF;
    INSERT INTO kl.stat_value (unit_version_id, indicator_key, geo_code, period_label, period_start, period_end, period_confidence, value_numeric, value_status,
      display_es, display_en, unit_label, source_published_at, locator, publication_id, primary_unit_version_id, rank_position, rank_of, tie_group, series_break_note, estimated)
    VALUES (v_id, p_content->>'indicator_key', p_content->>'geo_code', p_content->>'period_label', (p_content->>'period_start')::date, (p_content->>'period_end')::date,
      coalesce(p_content->>'period_confidence', 'declared'), (p_content->>'value_numeric')::numeric, coalesce(p_content->>'value_status', 'value'),
      p_content->>'display_es', p_content->>'display_en', p_content->>'unit_label', (p_content->>'source_published_at')::date, p_content->>'locator', v_pub, v_primary,
      (p_content->>'rank_position')::integer, (p_content->>'rank_of')::integer, (p_content->>'tie_group')::integer, p_content->>'series_break_note',
      coalesce((p_content->>'estimated')::boolean, false));
  ELSE
    SELECT id INTO v_pub FROM kl.publication WHERE key = p_content->>'primary_source_publication_key';
    INSERT INTO kl.card_content (unit_version_id, card_type, title_es, body_es, claims_es, cites, primary_source_publication_id, norm_published_at, norm_effective_from, last_reviewed_at)
    VALUES (v_id, p_content->>'card_type', p_content->>'title_es', p_content->>'body_es', kl._text_array(p_content->'claims_es'), coalesce(p_content->'cites', '[]'::jsonb), v_pub,
      (p_content->>'norm_published_at')::date, (p_content->>'norm_effective_from')::date, (p_content->>'last_reviewed_at')::date);
    IF p_variant_en IS NOT NULL THEN
      INSERT INTO kl.card_locale_variant (unit_version_id, locale, title, body, claims, status)
      VALUES (v_id, 'en', p_variant_en->>'title', p_variant_en->>'body', kl._text_array(p_variant_en->'claims'), 'draft');
    END IF;
  END IF;
  PERFORM kl.audit('kl.version.create', 'unit_version', v_id::text, NULL, 'draft', p_unit_key || '@' || v_next);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Envía a revisión (solo su autor). review_level = máx(nivel por riesgo, nivel por clase de cambio); validación
-- especializada requerida => nivel 3; unclassifiable => máx + 1 con tope 3 (Design Spec §6.1).
CREATE FUNCTION kl.submit_version(p_version_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v kl.unit_version; u kl.unit; v_risk integer; v_change integer; v_level integer;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  SELECT * INTO v FROM kl.unit_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: versión inexistente' USING ERRCODE = 'BV404'; END IF;
  IF v.authored_by <> v_actor THEN RAISE EXCEPTION 'BV403: solo el autor envía su versión a revisión' USING ERRCODE = 'BV403'; END IF;
  SELECT * INTO u FROM kl.unit WHERE id = v.unit_id;
  v_risk := CASE u.content_risk WHEN 'low' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END;
  v_change := CASE v.change_class WHEN 'new_period' THEN 1 WHEN 'correction' THEN 1 WHEN 'unclassifiable' THEN 1 ELSE 2 END;
  v_level := greatest(v_risk, v_change);
  IF v.change_class = 'unclassifiable' THEN v_level := least(3, v_level + 1); END IF;
  IF v.specialist_required THEN v_level := 3; END IF;
  UPDATE kl.unit_version SET status = 'in_review', review_level = v_level WHERE id = p_version_id;
  PERFORM kl.audit('kl.version.submit', 'unit_version', p_version_id::text, v.status, 'in_review', 'level ' || v_level);
  PERFORM kl.mutation_off();
  RETURN v_level;
END $$;

-- Aprueba nivel 1–2 (publica) o envía el nivel 3 a validación especializada. La doble intervención la impone el trigger.
CREATE FUNCTION kl.approve_version(p_version_id uuid, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v kl.unit_version; v_to text;
BEGIN
  v_actor := kl.begin_mutation('content.approve_l2');
  SELECT * INTO v FROM kl.unit_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'in_review' THEN RAISE EXCEPTION 'BV409: la versión no está en revisión' USING ERRCODE = 'BV409'; END IF;
  IF v.review_level >= 3 THEN
    UPDATE kl.unit_version SET status = 'awaiting_validation', approved_by = v_actor, approved_at = now() WHERE id = p_version_id;
    v_to := 'awaiting_validation';
  ELSE
    UPDATE kl.unit_version SET approved_by = v_actor, approved_at = now() WHERE id = p_version_id;
    PERFORM kl._publish_version(p_version_id, v_actor);
    v_to := 'published';
  END IF;
  PERFORM kl.audit('kl.version.approve', 'unit_version', p_version_id::text, 'in_review', v_to, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_to;
END $$;

CREATE FUNCTION kl.reject_version(p_version_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v kl.unit_version;
BEGIN
  PERFORM kl.begin_mutation('content.approve_l2');
  SELECT * INTO v FROM kl.unit_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR v.status NOT IN ('in_review', 'awaiting_validation') THEN RAISE EXCEPTION 'BV409: la versión no se puede rechazar en su estado' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.unit_version SET status = 'rejected' WHERE id = p_version_id;
  PERFORM kl.audit('kl.version.reject', 'unit_version', p_version_id::text, v.status, 'rejected', p_reason);
  PERFORM kl.mutation_off();
END $$;

-- Retira una ficha o estadística: versiones withdrawn, paquetes invalidados y aviso de cambio; la historia queda intacta (A06).
CREATE FUNCTION kl.withdraw_unit(p_unit_key text, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE u kl.unit; v_ids uuid[]; n integer;
BEGIN
  PERFORM kl.begin_mutation('source.decide');
  SELECT * INTO u FROM kl.unit WHERE unit_key = p_unit_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: unidad inexistente' USING ERRCODE = 'BV404'; END IF;
  SELECT array_agg(id) INTO v_ids FROM kl.unit_version WHERE unit_id = u.id AND status IN ('draft', 'in_review', 'awaiting_validation', 'published');
  n := coalesce(cardinality(v_ids), 0);
  IF n > 0 THEN PERFORM kl._withdraw_versions(v_ids, 'unit withdrawn: ' || p_unit_key); END IF;
  PERFORM kl.audit('kl.unit.withdraw', 'unit', u.id::text, NULL, 'withdrawn', p_reason);
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

-- Pasa a «expired» lo publicado cuyo valid_to venció e invalida sus paquetes (la lectura ya lo excluye por fecha).
CREATE FUNCTION kl.expire_due_versions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_ids uuid[]; n integer;
BEGIN
  PERFORM kl.begin_mutation('agent.compile');
  SELECT array_agg(id) INTO v_ids FROM kl.unit_version WHERE status = 'published' AND valid_to IS NOT NULL AND valid_to <= now();
  n := coalesce(cardinality(v_ids), 0);
  IF n > 0 THEN
    UPDATE kl.unit_version SET status = 'expired' WHERE id = ANY (v_ids);
    PERFORM kl._invalidate_packages(v_ids, 'valid_to reached');
    PERFORM kl.audit('kl.version.expire', 'unit_version', NULL, 'published', 'expired', n || ' versions');
  END IF;
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

-- Variante de idioma (en): traducción y aprobación por un revisor distinto del autor.
CREATE FUNCTION kl.approve_variant(p_version_id uuid, p_locale text DEFAULT 'en') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := kl.begin_mutation('content.approve_l2');
  UPDATE kl.card_locale_variant SET status = 'approved', reviewed_by = v_actor, approved_at = now(), updated_at = now()
   WHERE unit_version_id = p_version_id AND locale = p_locale AND status IN ('draft', 'in_translation');
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: variante inexistente o ya aprobada' USING ERRCODE = 'BV404'; END IF;
  PERFORM kl.audit('kl.variant.approve', 'unit_version', p_version_id::text, NULL, 'approved', p_locale);
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Validación especializada (nivel 3): la registra el validador de su dominio o, si es externo, un revisor.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.register_validator(p_kind text, p_admin_user_id uuid, p_display_name text, p_organization text, p_domains text[], p_engagement_ref text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('validation.record_external');
  INSERT INTO kl.validator (kind, admin_user_id, display_name, organization, domains, engagement_ref, registered_by)
  VALUES (p_kind, p_admin_user_id, p_display_name, p_organization, p_domains, p_engagement_ref, v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.validator.register', 'validator', v_id::text, NULL, 'active', p_kind);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.record_validation(p_version_id uuid, p_validator_id uuid, p_locale text, p_domain text, p_scope_statement text, p_verdict text,
  p_evidence_file_id uuid, p_validated_at timestamptz, p_expires_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE val kl.validator; v kl.unit_version; v_actor uuid; v_id uuid; v_result text;
BEGIN
  SELECT * INTO val FROM kl.validator WHERE id = p_validator_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: validador inexistente' USING ERRCODE = 'BV404'; END IF;
  SELECT * INTO v FROM kl.unit_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'awaiting_validation' THEN RAISE EXCEPTION 'BV409: la versión no espera validación' USING ERRCODE = 'BV409'; END IF;
  -- Un validador interno registra su propia validación (permiso por dominio); si no, la registra un revisor.
  IF val.kind = 'internal' AND val.admin_user_id = nullif((SELECT principal_id::text FROM kl.request_attestation WHERE txid = txid_current()), '')::uuid THEN
    v_actor := kl.begin_mutation('validation.validate', p_domain);
  ELSE
    v_actor := kl.begin_mutation('validation.record_external');
  END IF;
  INSERT INTO kl.specialist_validation (unit_version_id, content_sha256, locale, domain, scope_statement, verdict, validator_id, recorded_by, evidence_file_id, validated_at, expires_at)
  VALUES (p_version_id, v.content_sha256, p_locale, p_domain, p_scope_statement, p_verdict, p_validator_id, v_actor, p_evidence_file_id, p_validated_at, p_expires_at)
  RETURNING id INTO v_id;
  IF p_verdict = 'approved' THEN
    PERFORM kl._publish_version(p_version_id, v.approved_by);
    v_result := 'published';
  ELSIF p_verdict = 'rejected' THEN
    UPDATE kl.unit_version SET status = 'rejected' WHERE id = p_version_id;
    v_result := 'rejected';
  ELSE
    v_result := 'awaiting_validation';
  END IF;
  PERFORM kl.audit('kl.validation.record', 'specialist_validation', v_id::text, 'awaiting_validation', v_result, p_verdict);
  PERFORM kl.mutation_off();
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- I8 · Canal de carga
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.register_file_object(p_sha256 text, p_detected_type text, p_byte_length bigint, p_storage_key text, p_scan_result text, p_purpose text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid; v_max bigint;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  v_max := coalesce((kl._setting('kl.upload.max_bytes'))::text::bigint, 52428800);
  IF p_byte_length > v_max THEN RAISE EXCEPTION 'BV422: el archivo excede el tamaño máximo' USING ERRCODE = 'BV422'; END IF;
  -- Duplicado exacto = misma huella: se reutiliza el objeto existente (inmutable).
  SELECT id INTO v_id FROM kl.file_object WHERE sha256 = p_sha256;
  IF FOUND THEN
    PERFORM kl.mutation_off();
    RETURN v_id;
  END IF;
  INSERT INTO kl.file_object (sha256, detected_type, byte_length, storage_key, scan_result, uploaded_by, purpose)
  VALUES (p_sha256, p_detected_type, p_byte_length, p_storage_key, p_scan_result, v_actor, p_purpose) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.file.register', 'file_object', v_id::text, NULL, NULL, p_detected_type);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Carga rechazada antes de guardar el archivo: solo queda el motivo y la huella.
CREATE FUNCTION kl.reject_upload(p_origin text, p_sha256 text, p_reason text, p_publication_key text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid; v_pub uuid;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  IF p_publication_key IS NOT NULL THEN SELECT id INTO v_pub FROM kl.publication WHERE key = p_publication_key; END IF;
  INSERT INTO kl.ingest_batch (origin, publication_id, file_sha256, status, reject_reason, uploaded_by)
  VALUES (p_origin, v_pub, p_sha256, 'rejected', left(p_reason, 300), v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.batch.reject_upload', 'ingest_batch', v_id::text, NULL, 'rejected', p_reason);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.create_ingest_batch(p_origin text, p_publication_key text, p_edition_label text, p_source_published_at date, p_provenance_url text,
  p_declared_license text, p_file_object_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_pub kl.publication; v_id uuid; v_status text;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  IF p_publication_key IS NOT NULL THEN SELECT * INTO v_pub FROM kl.publication WHERE key = p_publication_key; END IF;
  v_status := CASE WHEN v_pub.id IS NOT NULL AND v_pub.status = 'approved' THEN 'received' ELSE 'awaiting_source' END;
  INSERT INTO kl.ingest_batch (origin, publication_id, edition_label, source_published_at, provenance_url, declared_license, file_object_id, status, uploaded_by)
  VALUES (p_origin, v_pub.id, p_edition_label, p_source_published_at, p_provenance_url, p_declared_license, p_file_object_id, v_status, v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.batch.create', 'ingest_batch', v_id::text, NULL, v_status, p_edition_label);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- La aprobación de la fuente libera las cargas que esperaban por ella.
CREATE FUNCTION kl.release_awaiting_batches(p_publication_key text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_pub kl.publication; n integer;
BEGIN
  PERFORM kl.begin_mutation('source.decide');
  SELECT * INTO v_pub FROM kl.publication WHERE key = p_publication_key;
  IF NOT FOUND OR v_pub.status <> 'approved' THEN RAISE EXCEPTION 'BV409: la fuente no está aprobada' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.ingest_batch SET status = 'received', updated_at = now() WHERE publication_id = v_pub.id AND status = 'awaiting_source';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

CREATE FUNCTION kl.add_extracted_rows(p_batch_id uuid, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; b kl.ingest_batch; r jsonb; n integer := 0;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  SELECT * INTO b FROM kl.ingest_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'received' OR b.uploaded_by <> v_actor THEN RAISE EXCEPTION 'BV409: la carga no está lista para extracción' USING ERRCODE = 'BV409'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO kl.extracted_row (batch_id, locator, raw_label, raw_value_text, indicator_key, geo_code, period_label, period_start, period_end, parsed_value, classification)
    VALUES (p_batch_id, r->>'locator', r->>'raw_label', r->>'raw_value_text', r->>'indicator_key', r->>'geo_code', r->>'period_label', (r->>'period_start')::date, (r->>'period_end')::date,
            (r->>'parsed_value')::numeric, r->>'classification');
    n := n + 1;
  END LOOP;
  UPDATE kl.ingest_batch SET status = 'extracted', updated_at = now() WHERE id = p_batch_id;
  PERFORM kl.audit('kl.batch.extract', 'ingest_batch', p_batch_id::text, 'received', 'extracted', n || ' rows');
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

-- El reporte de QA es inmutable; sin fallas bloqueantes la carga pasa a revisión.
CREATE FUNCTION kl.set_qa_report(p_batch_id uuid, p_checks jsonb, p_blocking_failures integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE b kl.ingest_batch; v_to text;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  SELECT * INTO b FROM kl.ingest_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'extracted' THEN RAISE EXCEPTION 'BV409: la carga no está extraída' USING ERRCODE = 'BV409'; END IF;
  INSERT INTO kl.qa_report (batch_id, checks, blocking_failures) VALUES (p_batch_id, p_checks, p_blocking_failures);
  v_to := CASE WHEN p_blocking_failures = 0 THEN 'in_review' ELSE 'extracted' END;
  IF v_to = 'in_review' THEN UPDATE kl.ingest_batch SET status = 'in_review', updated_at = now() WHERE id = p_batch_id; END IF;
  PERFORM kl.audit('kl.batch.qa', 'ingest_batch', p_batch_id::text, 'extracted', v_to, p_blocking_failures || ' blocking failures');
  PERFORM kl.mutation_off();
  RETURN v_to;
END $$;

-- El revisor corrige el mapeo (indicador, geografía, clasificación); nunca edita valores (T16).
CREATE FUNCTION kl.remap_extracted_row(p_row_id uuid, p_indicator_key text, p_geo_code text, p_classification text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.begin_mutation('content.approve_l2');
  UPDATE kl.extracted_row r SET indicator_key = p_indicator_key, geo_code = p_geo_code, classification = p_classification
   WHERE r.id = p_row_id AND EXISTS (SELECT 1 FROM kl.ingest_batch b WHERE b.id = r.batch_id AND b.status = 'in_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'BV409: la fila no se puede reasignar en este estado' USING ERRCODE = 'BV409'; END IF;
  PERFORM kl.audit('kl.batch.remap', 'extracted_row', p_row_id::text, NULL, NULL, p_indicator_key);
  PERFORM kl.mutation_off();
END $$;

CREATE FUNCTION kl.review_batch(p_batch_id uuid, p_approve boolean, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; b kl.ingest_batch; v_to text;
BEGIN
  v_actor := kl.begin_mutation('content.approve_l2');
  SELECT * INTO b FROM kl.ingest_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'in_review' THEN RAISE EXCEPTION 'BV409: la carga no está en revisión' USING ERRCODE = 'BV409'; END IF;
  IF p_approve THEN
    v_to := 'approved';
    UPDATE kl.ingest_batch SET status = 'approved', reviewed_by = v_actor, approved_by = v_actor, updated_at = now() WHERE id = p_batch_id;
  ELSE
    v_to := 'rejected';
    UPDATE kl.ingest_batch SET status = 'rejected', reviewed_by = v_actor, reject_reason = left(coalesce(p_reason, 'rejected by reviewer'), 300), updated_at = now() WHERE id = p_batch_id;
  END IF;
  PERFORM kl.audit('kl.batch.review', 'ingest_batch', p_batch_id::text, 'in_review', v_to, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_to;
END $$;

-- Publica la carga aprobada: cada fila de periodo nuevo se vuelve una unidad (periodo nuevo = unidad nueva) con su
-- versión publicada. La aprobación de la carga (≠ quien subió) es la aprobación de nivel 2 de sus versiones.
CREATE FUNCTION kl.publish_batch(p_batch_id uuid, p_catalog_version text DEFAULT 'provisional-1') RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; b kl.ingest_batch; pub kl.publication; r kl.extracted_row; ind kl.indicator; v_key text; v_unit uuid; v_ver uuid; v_n integer := 0; v_country text;
BEGIN
  v_actor := kl.begin_mutation('content.approve_l2');
  SELECT * INTO b FROM kl.ingest_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'approved' THEN RAISE EXCEPTION 'BV409: la carga no está aprobada' USING ERRCODE = 'BV409'; END IF;
  SELECT * INTO pub FROM kl.publication WHERE id = b.publication_id;
  IF NOT FOUND OR pub.status <> 'approved' THEN RAISE EXCEPTION 'BV409: la fuente de la carga no está aprobada' USING ERRCODE = 'BV409'; END IF;
  SELECT i.country INTO v_country FROM kl.institution i WHERE i.id = pub.institution_id;
  FOR r IN SELECT * FROM kl.extracted_row WHERE batch_id = p_batch_id AND classification IN ('new_period', 'correction') ORDER BY locator LOOP
    SELECT * INTO ind FROM kl.indicator WHERE key = r.indicator_key;
    IF NOT FOUND OR r.geo_code IS NULL OR r.period_label IS NULL OR r.period_start IS NULL OR r.period_end IS NULL THEN
      RAISE EXCEPTION 'BV409: la fila % no tiene mapeo completo', r.locator USING ERRCODE = 'BV409';
    END IF;
    v_key := lower('stat.' || v_country || '.' || r.indicator_key || '.' || regexp_replace(r.geo_code, '[^A-Za-z0-9]+', '-', 'g') || '.' || regexp_replace(r.period_label, '[^A-Za-z0-9]+', '-', 'g'));
    SELECT id INTO v_unit FROM kl.unit WHERE unit_key = v_key;
    IF NOT FOUND THEN
      INSERT INTO kl.unit (unit_key, kind, country, region, topic_key, category_keys, catalog_version, content_risk)
      VALUES (v_key, 'statistic', v_country, CASE WHEN r.geo_code ~ '^[A-Z]{2}-' THEN r.geo_code END, ind.key, '{}', p_catalog_version, pub.default_content_risk) RETURNING id INTO v_unit;
    END IF;
    INSERT INTO kl.unit_version (unit_id, version, supersedes_version_id, change_class, origin, batch_id, permitted_use, authored_by, content_sha256, review_level, next_review_at)
    SELECT v_unit, coalesce(max(uv.version), 0) + 1, (SELECT id FROM kl.unit_version WHERE unit_id = v_unit ORDER BY version DESC LIMIT 1), r.classification,
           CASE b.origin WHEN 'kseed' THEN 'kseed' WHEN 'collector_agent' THEN 'collector' ELSE 'team' END, p_batch_id, pub.permitted_use, b.uploaded_by,
           encode(sha256(convert_to(jsonb_build_object('batch', p_batch_id, 'locator', r.locator, 'value', r.parsed_value, 'label', r.raw_value_text)::text, 'UTF8')), 'hex'),
           CASE pub.default_content_risk WHEN 'low' THEN 1 ELSE 2 END, NULL
      FROM kl.unit_version uv WHERE uv.unit_id = v_unit
    RETURNING id INTO v_ver;
    INSERT INTO kl.stat_value (unit_version_id, indicator_key, geo_code, period_label, period_start, period_end, period_confidence, value_numeric, value_status,
      display_es, display_en, unit_label, source_published_at, locator, publication_id)
    VALUES (v_ver, r.indicator_key, r.geo_code, r.period_label, r.period_start, r.period_end, 'declared', r.parsed_value, CASE WHEN r.parsed_value IS NULL THEN 'not_available' ELSE 'value' END,
      coalesce(r.raw_value_text, 'n/d'), coalesce(r.raw_value_text, 'n/a'), ind.unit, b.source_published_at, r.locator, pub.id);
    UPDATE kl.unit_version SET status = 'in_review' WHERE id = v_ver;
    UPDATE kl.unit_version SET approved_by = b.approved_by, approved_at = now() WHERE id = v_ver;
    PERFORM kl._publish_version(v_ver, b.approved_by);
    v_n := v_n + 1;
  END LOOP;
  UPDATE kl.ingest_batch SET status = 'published', updated_at = now() WHERE id = p_batch_id;
  PERFORM kl.audit('kl.batch.publish', 'ingest_batch', p_batch_id::text, 'approved', 'published', v_n || ' versions');
  PERFORM kl.mutation_off();
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Paquetes de contexto (I5)
-- ---------------------------------------------------------------------------------------------------------------
-- Compila un paquete de RAM con versiones publicadas. La huella la calcula la base sobre el manifiesto y las huellas de
-- contenido, de modo que no depende del llamador. El paquete activo anterior queda retirado.
CREATE FUNCTION kl.compile_package(p_package_key text, p_level text, p_scope jsonb, p_version_ids uuid[], p_estimated_tokens integer, p_budget_tokens integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer; v_manifest jsonb; v_hash text; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('agent.compile');
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.context_package WHERE package_key = p_package_key;
  SELECT jsonb_agg(u.unit_key || '@' || uv.version ORDER BY u.unit_key, uv.version),
         encode(sha256(convert_to(string_agg(u.unit_key || '@' || uv.version || ':' || uv.content_sha256, E'\n' ORDER BY u.unit_key, uv.version), 'UTF8')), 'hex')
    INTO v_manifest, v_hash
    FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE uv.id = ANY (p_version_ids);
  IF v_manifest IS NULL THEN RAISE EXCEPTION 'BV422: un paquete necesita al menos una pieza' USING ERRCODE = 'BV422'; END IF;
  UPDATE kl.context_package SET status = 'retired' WHERE package_key = p_package_key AND status = 'active';
  INSERT INTO kl.context_package (package_key, version, level, scope, manifest, hash, estimated_tokens, budget_tokens, status, compiled_by)
  VALUES (p_package_key, v_next, p_level, p_scope, v_manifest, v_hash, p_estimated_tokens, p_budget_tokens, 'active', v_actor) RETURNING id INTO v_id;
  INSERT INTO kl.package_member (package_id, unit_version_id) SELECT v_id, x FROM unnest(p_version_ids) AS x;
  PERFORM kl.audit('kl.package.compile', 'context_package', v_id::text, NULL, 'active', p_package_key || '@' || v_next);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- I6 · Compuerta de afirmaciones aprobadas (CR-KL-001): apagada por defecto; activarla exige la referencia de aceptación.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.set_r10_claims(p_enabled boolean, p_acceptance_ref text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer; v_ref text := btrim(coalesce(p_acceptance_ref, ''));
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  IF p_enabled AND length(v_ref) < 3 THEN
    PERFORM kl.audit('kl.r10_claims.rejected', 'setting', 'kl.r10_claims_enabled', 'false', 'false', 'missing_acceptance_ref');
    PERFORM kl.mutation_off();
    RETURN 'rejected_missing_acceptance_ref';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = 'kl.r10_claims_enabled';
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES ('kl.r10_claims_enabled', v_next, to_jsonb(p_enabled), nullif(v_ref, ''), v_actor);
  PERFORM kl.audit('kl.r10_claims.set', 'setting', 'kl.r10_claims_enabled', NULL, p_enabled::text, v_ref);
  PERFORM kl.mutation_off();
  RETURN 'ok';
END $$;

-- Otras configuraciones con lista blanca. Los agentes no se pueden encender en R1.
CREATE FUNCTION kl.set_setting(p_key text, p_value jsonb, p_reference text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  IF p_key = 'kl.upload.max_bytes' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric NOT BETWEEN 1024 AND 524288000 THEN RAISE EXCEPTION 'BV422: tamaño fuera de rango' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.links.discovery_start' THEN
    IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^https://[^/\s]+' THEN RAISE EXCEPTION 'BV422: enlace no válido' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.agents_enabled' THEN
    IF p_value IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'BV403: los agentes no se habilitan en R1' USING ERRCODE = 'BV403'; END IF;
  ELSE
    RAISE EXCEPTION 'BV422: configuración desconocida' USING ERRCODE = 'BV422';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = p_key;
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES (p_key, v_next, p_value, left(p_reference, 200), v_actor);
  PERFORM kl.audit('kl.setting.set', 'setting', p_key, NULL, NULL, p_reference);
  PERFORM kl.mutation_off();
  RETURN v_next;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- I7 · Señales de demanda y uso (las invoca Precision con kl_reader_precision, sin bloquear el turno).
-- Lista blanca de campos: lo demás se descarta y solo se cuenta el descarte. Nada del cliente entra aquí.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.record_signal(p_signal jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE
  allowed constant text[] := ARRAY['contract', 'destinationCountry', 'region', 'topic', 'categoryKey', 'serviceId', 'informationType', 'coverage', 'partialUnitRefs', 'stage', 'locale', 'candidate', 'projectRef', 'occurredAt'];
  v_extras integer; v_key text; v_group uuid; v_at timestamptz; v_ins integer; v_refs text[];
BEGIN
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  IF p_signal IS NULL OR jsonb_typeof(p_signal) <> 'object' THEN
    INSERT INTO kl.signal_discard_daily (day, signals_rejected) VALUES (current_date, 1) ON CONFLICT (day) DO UPDATE SET signals_rejected = kl.signal_discard_daily.signals_rejected + 1;
    PERFORM kl.mutation_off();
    RETURN 'invalid';
  END IF;
  SELECT count(*) INTO v_extras FROM jsonb_object_keys(p_signal) k WHERE NOT (k = ANY (allowed));
  IF v_extras > 0 THEN
    INSERT INTO kl.signal_discard_daily (day, fields_discarded) VALUES (current_date, v_extras) ON CONFLICT (day) DO UPDATE SET fields_discarded = kl.signal_discard_daily.fields_discarded + v_extras;
  END IF;
  BEGIN
    v_at := (p_signal->>'occurredAt')::timestamptz;
    IF p_signal->>'contract' IS DISTINCT FROM 'kl.v1' OR v_at IS NULL OR v_at > now() + interval '1 day' OR v_at < now() - interval '7 days'
       OR coalesce(p_signal->>'projectRef', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid signal';
    END IF;
    v_refs := kl._text_array(p_signal->'partialUnitRefs');
    v_key := lower(concat_ws('|', p_signal->>'destinationCountry', coalesce(p_signal->>'region', ''), p_signal->>'topic', coalesce(p_signal->>'categoryKey', ''), coalesce(p_signal->>'serviceId', ''), p_signal->>'informationType'));
    INSERT INTO kl.demand_group (group_key, destination_country, region, topic, category_key, service_id, information_type, first_seen, last_seen, signal_count)
    VALUES (v_key, p_signal->>'destinationCountry', p_signal->>'region', p_signal->>'topic', p_signal->>'categoryKey', p_signal->>'serviceId', p_signal->>'informationType', v_at, v_at, 1)
    ON CONFLICT (group_key) DO UPDATE SET signal_count = kl.demand_group.signal_count + 1, last_seen = greatest(kl.demand_group.last_seen, excluded.last_seen), updated_at = now()
    RETURNING id INTO v_group;
    INSERT INTO kl.demand_signal (contract, destination_country, region, topic, category_key, service_id, information_type, coverage, partial_unit_refs, stage, locale, candidate, project_ref, occurred_at, group_id)
    VALUES ('kl.v1', p_signal->>'destinationCountry', p_signal->>'region', p_signal->>'topic', p_signal->>'categoryKey', p_signal->>'serviceId', p_signal->>'informationType', p_signal->>'coverage',
            v_refs, p_signal->>'stage', p_signal->>'locale', p_signal->>'candidate', p_signal->>'projectRef', v_at, v_group);
    INSERT INTO kl.demand_group_project (group_id, project_ref) VALUES (v_group, p_signal->>'projectRef') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 1 THEN UPDATE kl.demand_group SET distinct_projects = distinct_projects + 1 WHERE id = v_group; END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('kl.mutation_authorized', 'on', true);
    INSERT INTO kl.signal_discard_daily (day, signals_rejected) VALUES (current_date, 1) ON CONFLICT (day) DO UPDATE SET signals_rejected = kl.signal_discard_daily.signals_rejected + 1;
    PERFORM kl.mutation_off();
    RETURN 'invalid';
  END;
  PERFORM kl.mutation_off();
  RETURN 'recorded';
END $$;

CREATE FUNCTION kl.record_usage(p_batch jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE it jsonb; v_ver uuid; n integer := 0; v_count bigint;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'array' OR jsonb_array_length(p_batch) > 200 THEN RETURN 0; END IF;
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  FOR it IN SELECT * FROM jsonb_array_elements(p_batch) LOOP
    CONTINUE WHEN coalesce(it->>'ref', '') !~ '^[a-z0-9_.:-]+@[0-9]+$' OR it->>'stage' NOT IN ('understanding', 'precision_by_category')
               OR it->>'via' NOT IN ('ram', 'query') OR coalesce(it->>'destinationCountry', '') !~ '^[A-Z]{2}$';
    v_count := least(greatest(coalesce((it->>'count')::bigint, 1), 1), 1000);
    SELECT uv.id INTO v_ver FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id
     WHERE u.unit_key = split_part(it->>'ref', '@', 1) AND uv.version = split_part(it->>'ref', '@', 2)::integer;
    CONTINUE WHEN v_ver IS NULL;
    INSERT INTO kl.usage_daily (day, unit_version_id, stage, country, category_key, via, count)
    VALUES (current_date, v_ver, it->>'stage', it->>'destinationCountry', coalesce(it->>'categoryKey', ''), it->>'via', v_count)
    ON CONFLICT (day, unit_version_id, stage, country, category_key, via) DO UPDATE SET count = kl.usage_daily.count + excluded.count;
    n := n + 1;
  END LOOP;
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

CREATE FUNCTION kl.record_distribution(p_edition_ref text, p_locale text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_edition uuid;
BEGIN
  IF p_locale NOT IN ('es', 'en') THEN RETURN false; END IF;
  SELECT e.id INTO v_edition FROM kl.edition e JOIN kl.product p ON p.id = e.product_id
   WHERE p.key || '@' || e.code = p_edition_ref AND e.status = 'published';
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  INSERT INTO kl.distribution_daily (edition_id, locale, day, downloads) VALUES (v_edition, p_locale, current_date, 1)
  ON CONFLICT (edition_id, locale, day) DO UPDATE SET downloads = kl.distribution_daily.downloads + 1;
  PERFORM kl.mutation_off();
  RETURN true;
END $$;

-- Estado público de una edición (PO-2): una sola forma de respuesta; «unknown» para lo inexistente o mal formado.
CREATE FUNCTION kl.edition_public_status(p_verification_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition; cur kl.edition; v_hash text; v_prod text;
BEGIN
  v_hash := encode(sha256(convert_to(coalesce(p_verification_id, ''), 'UTF8')), 'hex');
  SELECT * INTO e FROM kl.edition WHERE verification_id_sha256 = v_hash AND coalesce(p_verification_id, '') ~ '^[a-z2-7]{26}$';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF e.status = 'revoked' THEN
    RETURN jsonb_build_object('status', 'revoked', 'editionCode', e.code, 'publishedOn', to_char(e.published_at, 'YYYY-MM-DD'), 'revokedOn', to_char(e.updated_at, 'YYYY-MM-DD'));
  END IF;
  IF e.status = 'published' THEN
    RETURN jsonb_build_object('status', 'current', 'editionCode', e.code, 'publishedOn', to_char(e.published_at, 'YYYY-MM-DD'));
  END IF;
  IF e.status IN ('superseded', 'unpublished') THEN
    SELECT * INTO cur FROM kl.edition WHERE product_id = e.product_id AND status = 'published';
    RETURN jsonb_build_object('status', 'superseded', 'editionCode', e.code, 'publishedOn', to_char(e.published_at, 'YYYY-MM-DD'), 'currentEditionCode', cur.code);
  END IF;
  RETURN jsonb_build_object('status', 'unknown');
END $$;
