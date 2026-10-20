-- KL-0005 · R3: Knowledge Products. Composición, compuertas de publicación, ediciones (compuesta → aprobada → publicada),
-- vistas previas separadas, distribución controlada, revocación propagada y control de jobs atrasados. No modifica
-- KL-0001..KL-0004: lo que cambia (claim_jobs, _withdraw_versions, set_setting) se redefine aquí con CREATE OR REPLACE.

ALTER TABLE kl.job DROP CONSTRAINT job_status_check;
ALTER TABLE kl.job ADD CONSTRAINT job_status_check CHECK (status IN ('queued', 'leased', 'succeeded', 'failed', 'dead', 'obsolete'));
ALTER TABLE kl.file_object DROP CONSTRAINT file_object_purpose_check;
ALTER TABLE kl.file_object ADD CONSTRAINT file_object_purpose_check CHECK (purpose IN ('source_original', 'validation_evidence', 'edition_pdf', 'edition_preview'));

SELECT kl.mutation_on();
INSERT INTO kl.job_kind (kind, allowed_keys, enqueue_permission, claim_role) VALUES
  ('render_preview', ARRAY['edition_id'], 'job.enqueue', 'SERVICE_KNOWLEDGE');
INSERT INTO kl.state_transition (entity, from_status, to_status) VALUES ('edition', 'rendering', 'in_approval');
SELECT kl.mutation_off();

-- Catálogo provisional versionado (AC-12): las claves de categoría, servicio e industria se validan contra él al publicar.
CREATE TABLE kl.catalog_entry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_version text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('category', 'service', 'industry')),
  key             text NOT NULL CHECK (key ~ '^[a-z0-9_.:-]{1,120}$'),
  created_by      uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_version, kind, key)
);

-- Bloques fijos con huella (prólogo del fundador, journey): texto aprobado, inmutable, nunca generado ni reescrito.
CREATE TABLE kl.fixed_block (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id       text NOT NULL CHECK (block_id ~ '^[a-z0-9_]{2,60}$'),
  version        text NOT NULL CHECK (version ~ '^[0-9]+(\.[0-9]+)*$'),
  locale         text NOT NULL CHECK (locale IN ('es', 'en')),
  content        jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  authored_by    uuid NOT NULL REFERENCES kl.principal (principal_id),
  approved_by    uuid REFERENCES kl.principal (principal_id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, version, locale),
  CONSTRAINT fixed_block_approval_pair CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT fixed_block_separation CHECK (approved_by IS NULL OR approved_by <> authored_by)
);

-- Términos privados (nombres de clientes o identidades de partners): nunca pueden aparecer en una edición.
CREATE TABLE kl.private_term (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term       text NOT NULL UNIQUE CHECK (length(term) BETWEEN 3 AND 120 AND term = lower(term)),
  kind       text NOT NULL CHECK (kind IN ('client', 'partner')),
  created_by uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Vistas previas (PDF de prueba): separadas de las ediciones; nunca se distribuyen.
CREATE TABLE kl.edition_preview (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id      uuid NOT NULL REFERENCES kl.edition (id),
  locale          text NOT NULL CHECK (locale IN ('es', 'en')),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  file_object_id  uuid NOT NULL REFERENCES kl.file_object (id),
  created_by      uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Normaliza texto para buscar términos privados: minúsculas y sin acentos comunes.
CREATE FUNCTION kl._fold(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = kl, pg_temp AS $$
  SELECT lower(translate(coalesce(p_text, ''), 'áéíóúüñÁÉÍÓÚÜÑàèìòùâêîôû', 'aeiouunAEIOUUNaeiouaeiou'));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.register_catalog_entries(p_catalog_version text, p_kind text, p_keys text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; n integer;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  INSERT INTO kl.catalog_entry (catalog_version, kind, key, created_by) SELECT p_catalog_version, p_kind, k, v_actor FROM unnest(p_keys) AS k ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM kl.audit('kl.catalog.register', 'catalog', p_catalog_version, NULL, p_kind, n || ' keys');
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

CREATE FUNCTION kl.add_private_term(p_term text, p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  INSERT INTO kl.private_term (term, kind, created_by) VALUES (kl._fold(btrim(p_term)), p_kind, v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.private_term.add', 'private_term', v_id::text, NULL, p_kind, NULL); -- el término no se registra en la auditoría
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Fijos y enlaces requeridos por producto: {"fixedBlocks":[{"blockId":"founder_letter","version":"3.0"}],"links":["kl.links.discovery_start"]}
CREATE FUNCTION kl.set_product_config(p_product_key text, p_config jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer; v_key text := 'kl.product.' || p_product_key || '.config';
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  IF NOT EXISTS (SELECT 1 FROM kl.product WHERE key = p_product_key) THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
  IF jsonb_typeof(p_config -> 'fixedBlocks') <> 'array' OR jsonb_typeof(p_config -> 'links') <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_config -> 'links') l WHERE l !~ '^kl\.links\.[a-z0-9_]{2,60}$') THEN
    RAISE EXCEPTION 'BV422: configuración de producto no válida' USING ERRCODE = 'BV422';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = v_key;
  INSERT INTO kl.setting_version (key, version, value, authored_by) VALUES (v_key, v_next, p_config, v_actor);
  PERFORM kl.audit('kl.product.config', 'product', p_product_key, NULL, NULL, 'v' || v_next);
  PERFORM kl.mutation_off();
  RETURN v_next;
END $$;

-- set_setting (KL-0003) se redefine con las claves que R3 necesita. Los agentes siguen sin poder encenderse.
CREATE OR REPLACE FUNCTION kl.set_setting(p_key text, p_value jsonb, p_reference text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  IF p_key = 'kl.upload.max_bytes' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric NOT BETWEEN 1024 AND 524288000 THEN RAISE EXCEPTION 'BV422: tamaño fuera de rango' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key IN ('kl.links.discovery_start', 'kl.links.journey_guide') THEN
    IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^https://[^/\s]+' THEN RAISE EXCEPTION 'BV422: enlace no válido' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.links.edition_verify' THEN
    -- Plantilla con el marcador [edition-id]; el valor se congela en el manifiesto de cada edición.
    IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^https://[^/\s]+.*\[edition-id\]' THEN RAISE EXCEPTION 'BV422: la plantilla de verificación debe ser https y contener [edition-id]' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.jobs.stale_after_hours' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric NOT BETWEEN 1 AND 720 THEN RAISE EXCEPTION 'BV422: horas fuera de rango' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.agents.max_batch' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'BV422: lote fuera de rango' USING ERRCODE = 'BV422'; END IF;
  ELSIF p_key = 'kl.agents_enabled' THEN
    IF p_value IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'BV403: los agentes no se habilitan en esta fase' USING ERRCODE = 'BV403'; END IF;
  ELSE
    RAISE EXCEPTION 'BV422: configuración desconocida' USING ERRCODE = 'BV422';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = p_key;
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES (p_key, v_next, p_value, left(p_reference, 200), v_actor);
  PERFORM kl.audit('kl.setting.set', 'setting', p_key, NULL, NULL, p_reference);
  PERFORM kl.mutation_off();
  RETURN v_next;
END $$;

-- Bloques fijos: el texto lo redacta un editor y lo aprueba otra persona con rol editorial; la huella queda fija.
CREATE FUNCTION kl.register_fixed_block(p_block_id text, p_version text, p_locale text, p_content jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  INSERT INTO kl.fixed_block (block_id, version, locale, content, content_sha256, authored_by)
  VALUES (p_block_id, p_version, p_locale, p_content, encode(sha256(convert_to(p_content::text, 'UTF8')), 'hex'), v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.fixed_block.register', 'fixed_block', v_id::text, NULL, 'draft', p_block_id || '@' || p_version || ' ' || p_locale);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.approve_fixed_block(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; b kl.fixed_block;
BEGIN
  v_actor := kl.begin_mutation('edition.approve');
  SELECT * INTO b FROM kl.fixed_block WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'draft' THEN RAISE EXCEPTION 'BV409: el bloque no está pendiente' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.fixed_block SET status = 'approved', approved_by = v_actor, approved_at = now() WHERE id = p_id;
  PERFORM kl.audit('kl.fixed_block.approve', 'fixed_block', p_id::text, 'draft', 'approved', b.block_id || '@' || b.version || ' ' || b.locale);
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Composición
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.add_product_section(p_product_key text, p_section_key text, p_chapter text, p_part text, p_slot text, p_sort integer, p_title_es text, p_title_en text,
  p_content_type text, p_category_keys text[], p_validation_domain text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_id uuid; v_prod uuid;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  SELECT id INTO v_prod FROM kl.product WHERE key = p_product_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
  INSERT INTO kl.product_section (product_id, section_key, chapter, part, slot, sort_order, title_es, title_en, content_type, category_keys, validation_domain)
  VALUES (v_prod, p_section_key, p_chapter, p_part, p_slot, p_sort, p_title_es, p_title_en, p_content_type, coalesce(p_category_keys, '{}'), p_validation_domain) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.section.add', 'product_section', v_id::text, NULL, NULL, p_product_key || '/' || p_section_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.compose_unit(p_product_key text, p_section_key text, p_unit_key text, p_sort integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_section uuid; v_unit uuid; v_id uuid;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  SELECT ps.id INTO v_section FROM kl.product_section ps JOIN kl.product pr ON pr.id = ps.product_id WHERE pr.key = p_product_key AND ps.section_key = p_section_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: sección inexistente' USING ERRCODE = 'BV404'; END IF;
  SELECT id INTO v_unit FROM kl.unit WHERE unit_key = p_unit_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: unidad inexistente' USING ERRCODE = 'BV404'; END IF;
  INSERT INTO kl.composition_item (section_id, unit_id, sort_order) VALUES (v_section, v_unit, p_sort) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.composition.add', 'composition_item', v_id::text, NULL, 'draft', p_unit_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Fija a cada pieza su última versión publicada y vigente y refleja su estado editorial.
CREATE FUNCTION kl._refresh_pins(p_product_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE kl.composition_item ci SET
    pinned_version_id = s.vid,
    status = CASE
      WHEN s.vid IS NULL OR s.requires_review THEN 'requires_review'
      WHEN s.kind = 'statistic' THEN 'approved_en'
      WHEN s.en_status = 'approved' THEN 'approved_en'
      ELSE 'approved_es' END
  FROM (
    SELECT ci2.id AS item_id, u.kind, pin.id AS vid, pin.requires_review,
           (SELECT lv.status FROM kl.card_locale_variant lv WHERE lv.unit_version_id = pin.id AND lv.locale = 'en') AS en_status
      FROM kl.composition_item ci2
      JOIN kl.product_section ps ON ps.id = ci2.section_id AND ps.product_id = p_product_id
      JOIN kl.unit u ON u.id = ci2.unit_id
      LEFT JOIN LATERAL (
        SELECT vv.id, vv.requires_review FROM kl.unit_version vv
         WHERE vv.unit_id = u.id AND vv.status = 'published' AND (vv.valid_to IS NULL OR vv.valid_to > now()) ORDER BY vv.version DESC LIMIT 1
      ) pin ON true
  ) s
  WHERE s.item_id = ci.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Compuertas de publicación (AC-01…AC-06, AC-12). Cada control es un código con su motivo; ninguno se salta.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl._edition_controls(p_edition uuid) RETURNS TABLE (code text, ok boolean, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition; pr kl.product; v_cfg jsonb;
BEGIN
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: edición inexistente' USING ERRCODE = 'BV404'; END IF;
  SELECT * INTO pr FROM kl.product WHERE id = e.product_id;
  v_cfg := kl._setting('kl.product.' || pr.key || '.config');
  RETURN QUERY
  WITH pins AS (
    SELECT ci.id AS item_id, ps.section_key, ps.content_type, ci.unit_id, u.unit_key, u.kind, u.content_risk, u.category_keys, u.service_ids, u.catalog_version,
           uv.id AS vid, uv.version, uv.status AS vstatus, uv.requires_review, uv.permitted_use, uv.specialist_required, uv.content_sha256, uv.valid_to, uv.limits_es, uv.limits_en,
           sv.publication_id AS stat_pub, sv.indicator_key, sv.display_es, sv.display_en,
           cc.primary_source_publication_id AS card_pub, cc.card_type, cc.title_es, cc.body_es, cc.claims_es,
           lv.status AS en_status, lv.title AS en_title, lv.body AS en_body, lv.claims AS en_claims
      FROM kl.composition_item ci
      JOIN kl.product_section ps ON ps.id = ci.section_id AND ps.product_id = e.product_id
      JOIN kl.unit u ON u.id = ci.unit_id
      LEFT JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id
      LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
      LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
      LEFT JOIN kl.card_locale_variant lv ON lv.unit_version_id = uv.id AND lv.locale = 'en'
  ), texts AS (
    SELECT p.unit_key, kl._fold(concat_ws(' ', p.title_es, p.body_es, array_to_string(p.claims_es, ' '), p.en_title, p.en_body, array_to_string(p.en_claims, ' '), array_to_string(p.limits_es, ' '), array_to_string(p.limits_en, ' '), p.display_es, p.display_en)) AS t FROM pins p
  )
  SELECT 'PRODUCT_CONFIG'::text, v_cfg IS NOT NULL, CASE WHEN v_cfg IS NULL THEN 'el producto no tiene configuración (bloques fijos y enlaces)' ELSE '' END
  UNION ALL SELECT 'NOT_EMPTY', (SELECT count(*) FROM pins) > 0, CASE WHEN (SELECT count(*) FROM pins) = 0 THEN 'la composición está vacía' ELSE '' END
  UNION ALL SELECT 'PINNED_PUBLISHED', NOT EXISTS (SELECT 1 FROM pins WHERE vid IS NULL OR vstatus <> 'published' OR (valid_to IS NOT NULL AND valid_to <= now())),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE vid IS NULL OR vstatus <> 'published' OR (valid_to IS NOT NULL AND valid_to <= now())), '')
  UNION ALL SELECT 'NO_REQUIRES_REVIEW', NOT EXISTS (SELECT 1 FROM pins WHERE requires_review), coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE requires_review), '')
  UNION ALL SELECT 'SECTION_KIND', NOT EXISTS (SELECT 1 FROM pins WHERE (content_type = 'data' AND kind <> 'statistic') OR (content_type IN ('guidance', 'obligation') AND kind <> 'card') OR content_type = 'generated'),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE (content_type = 'data' AND kind <> 'statistic') OR (content_type IN ('guidance', 'obligation') AND kind <> 'card') OR content_type = 'generated'), '')
  UNION ALL SELECT 'SOURCE_APPROVED', NOT EXISTS (
      SELECT 1 FROM pins WHERE (content_type = 'obligation' AND card_pub IS NULL)
         OR (coalesce(stat_pub, card_pub) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kl.publication pb WHERE pb.id = coalesce(stat_pub, card_pub) AND pb.status = 'approved'))),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE (content_type = 'obligation' AND card_pub IS NULL)
         OR (coalesce(stat_pub, card_pub) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kl.publication pb WHERE pb.id = coalesce(stat_pub, card_pub) AND pb.status = 'approved'))), '')
  UNION ALL SELECT 'SPECIALIST_VALIDATION', NOT EXISTS (
      SELECT 1 FROM pins WHERE (content_risk = 'high' OR specialist_required) AND NOT EXISTS (
        SELECT 1 FROM kl.specialist_validation sv2 WHERE sv2.unit_version_id = pins.vid AND sv2.content_sha256 = pins.content_sha256 AND sv2.verdict = 'approved' AND sv2.status = 'valid' AND sv2.expires_at > now())),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE (content_risk = 'high' OR specialist_required) AND NOT EXISTS (
        SELECT 1 FROM kl.specialist_validation sv2 WHERE sv2.unit_version_id = pins.vid AND sv2.content_sha256 = pins.content_sha256 AND sv2.verdict = 'approved' AND sv2.status = 'valid' AND sv2.expires_at > now())), '')
  UNION ALL SELECT 'LOCALE_PAIR', NOT EXISTS (SELECT 1 FROM pins WHERE kind = 'card' AND (en_status IS DISTINCT FROM 'approved' OR cardinality(claims_es) <> cardinality(coalesce(en_claims, '{}')))),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE kind = 'card' AND (en_status IS DISTINCT FROM 'approved' OR cardinality(claims_es) <> cardinality(coalesce(en_claims, '{}')))), '')
  UNION ALL SELECT 'PERMITTED_USE', NOT EXISTS (SELECT 1 FROM pins WHERE permitted_use = 'cite_only' AND content_type <> 'data'), coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE permitted_use = 'cite_only' AND content_type <> 'data'), '')
  UNION ALL SELECT 'CATALOG_KEYS', NOT EXISTS (
      SELECT 1 FROM pins WHERE EXISTS (SELECT 1 FROM unnest(category_keys) k WHERE NOT EXISTS (SELECT 1 FROM kl.catalog_entry c WHERE c.catalog_version = pins.catalog_version AND c.kind = 'category' AND c.key = k))
         OR EXISTS (SELECT 1 FROM unnest(service_ids) k WHERE NOT EXISTS (SELECT 1 FROM kl.catalog_entry c WHERE c.catalog_version = pins.catalog_version AND c.kind = 'service' AND c.key = k))),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE EXISTS (SELECT 1 FROM unnest(category_keys) k WHERE NOT EXISTS (SELECT 1 FROM kl.catalog_entry c WHERE c.catalog_version = pins.catalog_version AND c.kind = 'category' AND c.key = k))
         OR EXISTS (SELECT 1 FROM unnest(service_ids) k WHERE NOT EXISTS (SELECT 1 FROM kl.catalog_entry c WHERE c.catalog_version = pins.catalog_version AND c.kind = 'service' AND c.key = k))), '')
  UNION ALL SELECT 'ALLOWED_CONTENT', NOT EXISTS (
      SELECT 1 FROM pins WHERE (kind = 'statistic' AND NOT EXISTS (SELECT 1 FROM kl.indicator i WHERE i.key = pins.indicator_key AND i.nature = 'objective'))
         OR EXISTS (SELECT 1 FROM kl.publication pb JOIN kl.institution it ON it.id = pb.institution_id WHERE pb.id = coalesce(stat_pub, card_pub) AND (pb.expected_periodicity = 'daily' OR it.kind = 'partner'))),
    coalesce((SELECT string_agg(unit_key, ', ' ORDER BY unit_key) FROM pins WHERE (kind = 'statistic' AND NOT EXISTS (SELECT 1 FROM kl.indicator i WHERE i.key = pins.indicator_key AND i.nature = 'objective'))
         OR EXISTS (SELECT 1 FROM kl.publication pb JOIN kl.institution it ON it.id = pb.institution_id WHERE pb.id = coalesce(stat_pub, card_pub) AND (pb.expected_periodicity = 'daily' OR it.kind = 'partner'))), '')
  UNION ALL SELECT 'NO_PRIVATE_DATA', NOT EXISTS (SELECT 1 FROM texts t JOIN kl.private_term pt ON position(pt.term IN t.t) > 0 OR t.t ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'),
    coalesce((SELECT string_agg(DISTINCT t.unit_key, ', ') FROM texts t WHERE EXISTS (SELECT 1 FROM kl.private_term pt WHERE position(pt.term IN t.t) > 0) OR t.t ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'), '')
  UNION ALL SELECT 'FIXED_BLOCKS', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(v_cfg -> 'fixedBlocks', '[]'::jsonb)) fb, unnest(ARRAY['es', 'en']) l
       WHERE NOT EXISTS (SELECT 1 FROM kl.fixed_block b WHERE b.block_id = fb ->> 'blockId' AND b.version = fb ->> 'version' AND b.locale = l AND b.status = 'approved')),
    coalesce((SELECT string_agg(DISTINCT fb ->> 'blockId', ', ') FROM jsonb_array_elements(coalesce(v_cfg -> 'fixedBlocks', '[]'::jsonb)) fb, unnest(ARRAY['es', 'en']) l
       WHERE NOT EXISTS (SELECT 1 FROM kl.fixed_block b WHERE b.block_id = fb ->> 'blockId' AND b.version = fb ->> 'version' AND b.locale = l AND b.status = 'approved')), '')
  UNION ALL SELECT 'LINKS_CONFIGURED', NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v_cfg -> 'links', '[]'::jsonb)) lk WHERE coalesce(kl._setting(lk) #>> '{}', '') !~ '^https://'),
    coalesce((SELECT string_agg(lk, ', ') FROM jsonb_array_elements_text(coalesce(v_cfg -> 'links', '[]'::jsonb)) lk WHERE coalesce(kl._setting(lk) #>> '{}', '') !~ '^https://'), '');
END $$;

CREATE FUNCTION kl.edition_controls(p_edition uuid) RETURNS TABLE (code text, ok boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.require('kl.read');
  RETURN QUERY SELECT c.code, c.ok, c.detail FROM kl._edition_controls(p_edition) c;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Ediciones: composing → in_approval → rendering → published
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.decide_change_notice(p_notice_id uuid, p_decision text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; n kl.change_notice;
BEGIN
  v_actor := kl.begin_mutation('product.approve_change');
  IF p_decision NOT IN ('approved_for_next', 'dismissed') THEN RAISE EXCEPTION 'BV422: decisión no válida' USING ERRCODE = 'BV422'; END IF;
  SELECT * INTO n FROM kl.change_notice WHERE id = p_notice_id FOR UPDATE;
  IF NOT FOUND OR n.status <> 'pending' THEN RAISE EXCEPTION 'BV409: el aviso no está pendiente' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.change_notice SET status = p_decision, decided_by = v_actor, decided_at = now() WHERE id = p_notice_id;
  PERFORM kl.audit('kl.change_notice.decide', 'change_notice', p_notice_id::text, 'pending', p_decision, p_reason);
  PERFORM kl.mutation_off();
END $$;

-- Abre una edición. La primera no necesita avisos; las siguientes exigen al menos un aviso aprobado sin consumir o una edición
-- extraordinaria encolada (AC-08: sin cambios aprobados no hay edición nueva). El informe de cambios sale de esos avisos.
CREATE FUNCTION kl.open_edition(p_product_key text, p_code text, p_cutoff date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; pr kl.product; v_id uuid; v_notices jsonb; v_extra uuid; v_first boolean; v_reason text;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  SELECT * INTO pr FROM kl.product WHERE key = p_product_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
  IF EXISTS (SELECT 1 FROM kl.edition WHERE product_id = pr.id AND status IN ('composing', 'in_approval', 'rendering')) THEN
    RAISE EXCEPTION 'BV409: ya hay una edición en curso para este producto' USING ERRCODE = 'BV409';
  END IF;
  v_first := NOT EXISTS (SELECT 1 FROM kl.edition WHERE product_id = pr.id AND status IN ('published', 'superseded', 'unpublished', 'revoked'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('noticeId', n.id, 'kind', n.kind, 'unitKey', u.unit_key, 'fromVersion', fv.version, 'toVersion', tv.version) ORDER BY u.unit_key, n.created_at), '[]'::jsonb) INTO v_notices
    FROM kl.change_notice n JOIN kl.unit u ON u.id = n.unit_id LEFT JOIN kl.unit_version fv ON fv.id = n.from_version_id LEFT JOIN kl.unit_version tv ON tv.id = n.to_version_id
   WHERE n.product_id = pr.id AND n.status = 'approved_for_next'
     AND NOT EXISTS (SELECT 1 FROM kl.edition ed WHERE ed.product_id = pr.id AND ed.change_report -> 'notices' @> jsonb_build_array(jsonb_build_object('noticeId', n.id)));
  SELECT job_id INTO v_extra FROM kl.job WHERE kind = 'extraordinary_edition' AND payload ->> 'product_key' = p_product_key AND status IN ('queued', 'leased') ORDER BY created_at LIMIT 1;
  IF NOT v_first AND jsonb_array_length(v_notices) = 0 AND v_extra IS NULL THEN
    RAISE EXCEPTION 'BV409: sin avisos de cambio aprobados no se abre una edición nueva' USING ERRCODE = 'BV409';
  END IF;
  v_reason := CASE WHEN v_first THEN 'first_edition' WHEN jsonb_array_length(v_notices) > 0 THEN 'approved_changes' ELSE 'extraordinary' END;
  IF v_extra IS NOT NULL AND NOT v_first THEN
    UPDATE kl.job SET status = 'succeeded', lease_until = NULL, leased_by = NULL, lease_token = NULL, updated_at = now() WHERE job_id = v_extra; -- se consume
  END IF;
  INSERT INTO kl.edition (product_id, code, cutoff_date, change_report, composed_by)
  VALUES (pr.id, p_code, p_cutoff, jsonb_build_object('reason', v_reason, 'notices', v_notices), v_actor) RETURNING id INTO v_id;
  PERFORM kl._refresh_pins(pr.id);
  PERFORM kl.audit('kl.edition.open', 'edition', v_id::text, NULL, 'composing', p_product_key || '@' || p_code || ' (' || v_reason || ')');
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.refresh_pins(p_edition uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition; n integer;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND OR e.status <> 'composing' THEN RAISE EXCEPTION 'BV409: solo una edición en composición se actualiza' USING ERRCODE = 'BV409'; END IF;
  n := kl._refresh_pins(e.product_id);
  PERFORM kl.mutation_off();
  RETURN n;
END $$;

-- Pasa a aprobación: re-fija versiones, ejecuta TODAS las compuertas y congela el manifiesto. El manifiesto lo arma el generador, pero la
-- base verifica que no contenga nada ajeno (mismas unidades, mismos bloques fijos con su huella, mismos enlaces).
CREATE FUNCTION kl.submit_edition(p_edition uuid, p_manifest jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; e kl.edition; pr kl.product; v_failed text; v_cfg jsonb; v_pinned text[]; v_listed text[]; v_sha text; fb jsonb; l text; v_db_sha text;
BEGIN
  v_actor := kl.begin_mutation('content.author');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition FOR UPDATE;
  IF NOT FOUND OR e.status <> 'composing' THEN RAISE EXCEPTION 'BV409: la edición no está en composición' USING ERRCODE = 'BV409'; END IF;
  IF e.composed_by <> v_actor THEN RAISE EXCEPTION 'BV403: solo quien compone la edición la envía a aprobación' USING ERRCODE = 'BV403'; END IF;
  SELECT * INTO pr FROM kl.product WHERE id = e.product_id;
  PERFORM kl._refresh_pins(pr.id);
  SELECT string_agg(c.code || CASE WHEN c.detail <> '' THEN ' (' || c.detail || ')' ELSE '' END, '; ' ORDER BY c.code) INTO v_failed FROM kl._edition_controls(p_edition) c WHERE NOT c.ok;
  IF v_failed IS NOT NULL THEN RAISE EXCEPTION 'BV409: compuertas sin cumplir: %', v_failed USING ERRCODE = 'BV409'; END IF;

  v_cfg := kl._setting('kl.product.' || pr.key || '.config');
  IF p_manifest ->> 'theme' IS DISTINCT FROM 'db.v3b' OR p_manifest #>> '{fonts,family}' NOT IN ('lato', 'publicsans') OR jsonb_typeof(p_manifest -> 'unitRefs') <> 'array' THEN
    RAISE EXCEPTION 'BV422: manifiesto sin tema, fuentes o unidades válidas' USING ERRCODE = 'BV422';
  END IF;
  SELECT array_agg(u.unit_key || '@' || uv.version ORDER BY u.unit_key) INTO v_pinned
    FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id AND ps.product_id = pr.id JOIN kl.unit u ON u.id = ci.unit_id JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id;
  SELECT array_agg(x ORDER BY x) INTO v_listed FROM jsonb_array_elements_text(p_manifest -> 'unitRefs') x;
  IF v_pinned IS DISTINCT FROM v_listed THEN RAISE EXCEPTION 'BV409: el manifiesto no coincide con las versiones fijadas' USING ERRCODE = 'BV409'; END IF;
  -- bloques fijos con su huella exacta; enlaces con su valor vigente
  FOR fb IN SELECT * FROM jsonb_array_elements(coalesce(v_cfg -> 'fixedBlocks', '[]'::jsonb)) LOOP
    FOREACH l IN ARRAY ARRAY['es', 'en'] LOOP
      SELECT content_sha256 INTO v_db_sha FROM kl.fixed_block WHERE block_id = fb ->> 'blockId' AND version = fb ->> 'version' AND locale = l AND status = 'approved';
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_manifest -> 'fixedBlocks', '[]'::jsonb)) m
                      WHERE m ->> 'blockId' = fb ->> 'blockId' AND m ->> 'version' = fb ->> 'version' AND m ->> ('sha256_' || l) = v_db_sha) THEN
        RAISE EXCEPTION 'BV409: el bloque fijo % no coincide con su versión aprobada', fb ->> 'blockId' USING ERRCODE = 'BV409';
      END IF;
    END LOOP;
  END LOOP;
  FOR l IN SELECT jsonb_array_elements_text(coalesce(v_cfg -> 'links', '[]'::jsonb)) LOOP
    IF (p_manifest -> 'links' ->> l) IS DISTINCT FROM (kl._setting(l) #>> '{}') THEN RAISE EXCEPTION 'BV409: el enlace % del manifiesto no es el configurado', l USING ERRCODE = 'BV409'; END IF;
  END LOOP;
  v_sha := encode(sha256(convert_to(p_manifest::text, 'UTF8')), 'hex');
  UPDATE kl.edition SET status = 'in_approval', manifest = p_manifest, manifest_sha256 = v_sha, updated_at = now() WHERE id = p_edition;
  PERFORM kl.audit('kl.edition.submit', 'edition', p_edition::text, 'composing', 'in_approval', left(v_sha, 12));
  PERFORM kl.mutation_off();
  RETURN v_sha;
END $$;

CREATE FUNCTION kl.return_edition_to_composing(p_edition uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition;
BEGIN
  PERFORM kl.begin_mutation('edition.approve');
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'BV422: el motivo es obligatorio' USING ERRCODE = 'BV422'; END IF;
  SELECT * INTO e FROM kl.edition WHERE id = p_edition FOR UPDATE;
  IF NOT FOUND OR e.status <> 'in_approval' THEN RAISE EXCEPTION 'BV409: la edición no está en aprobación' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.edition SET status = 'composing', manifest = NULL, manifest_sha256 = NULL, approved_by = NULL, updated_at = now() WHERE id = p_edition;
  PERFORM kl.audit('kl.edition.return', 'edition', p_edition::text, 'in_approval', 'composing', p_reason);
  PERFORM kl.mutation_off();
END $$;

-- Aprobación editorial (otra persona con rol editorial): vuelve a evaluar las compuertas y encola el render ES y EN.
CREATE FUNCTION kl.approve_edition(p_edition uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; e kl.edition; v_failed text; v_job uuid;
BEGIN
  v_actor := kl.begin_mutation('edition.approve');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition FOR UPDATE;
  IF NOT FOUND OR e.status <> 'in_approval' THEN RAISE EXCEPTION 'BV409: la edición no está en aprobación' USING ERRCODE = 'BV409'; END IF;
  IF e.composed_by = v_actor THEN RAISE EXCEPTION 'BV403: quien compuso la edición no puede aprobarla' USING ERRCODE = 'BV403'; END IF;
  SELECT string_agg(c.code || CASE WHEN c.detail <> '' THEN ' (' || c.detail || ')' ELSE '' END, '; ' ORDER BY c.code) INTO v_failed FROM kl._edition_controls(p_edition) c WHERE NOT c.ok;
  IF v_failed IS NOT NULL THEN RAISE EXCEPTION 'BV409: compuertas sin cumplir: %', v_failed USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.edition SET status = 'rendering', approved_by = v_actor, updated_at = now() WHERE id = p_edition;
  v_job := kl._enqueue('render_edition', jsonb_build_object('edition_id', p_edition::text), v_actor);
  PERFORM kl.audit('kl.edition.approve', 'edition', p_edition::text, 'in_approval', 'rendering', left(e.manifest_sha256, 12));
  PERFORM kl.mutation_off();
  RETURN v_job;
END $$;

-- Vista previa (PDF de prueba) de una edición en aprobación; nunca entra a la distribución.
CREATE FUNCTION kl.request_preview(p_edition uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; e kl.edition; v_job uuid;
BEGIN
  v_actor := kl.begin_mutation('job.enqueue');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND OR e.status <> 'in_approval' THEN RAISE EXCEPTION 'BV409: la vista previa solo existe para una edición en aprobación' USING ERRCODE = 'BV409'; END IF;
  v_job := kl._enqueue('render_preview', jsonb_build_object('edition_id', p_edition::text), v_actor);
  PERFORM kl.audit('kl.edition.preview', 'edition', p_edition::text, NULL, 'queued', NULL);
  PERFORM kl.mutation_off();
  RETURN v_job;
END $$;

-- Datos exactos (versiones del manifiesto) para el generador. Solo la cuenta de conocimiento.
CREATE FUNCTION kl.edition_snapshot(p_edition uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition; pr kl.product; v_units jsonb; v_sections jsonb; v_fixed jsonb;
BEGIN
  PERFORM kl.require('agent.compile');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND OR e.manifest IS NULL OR e.status NOT IN ('in_approval', 'rendering') THEN RAISE EXCEPTION 'BV409: la edición no tiene manifiesto congelado para generar' USING ERRCODE = 'BV409'; END IF;
  SELECT * INTO pr FROM kl.product WHERE id = e.product_id;
  SELECT coalesce(jsonb_object_agg(r.ref, jsonb_build_object(
      'kind', u.kind, 'unitKey', u.unit_key, 'version', uv.version, 'country', u.country, 'topic', u.topic_key, 'categoryKeys', to_jsonb(u.category_keys), 'contentSha256', uv.content_sha256,
      'permittedUse', uv.permitted_use, 'limits', jsonb_build_object('es', to_jsonb(uv.limits_es), 'en', to_jsonb(uv.limits_en)), 'risk', u.content_risk,
      'stat', CASE WHEN u.kind = 'statistic' THEN jsonb_build_object('indicatorKey', sv.indicator_key, 'indicatorName', jsonb_build_object('es', ind.name_es, 'en', ind.name_en), 'geo', sv.geo_code, 'periodLabel', sv.period_label,
                    'periodStart', sv.period_start, 'periodEnd', sv.period_end, 'display', jsonb_build_object('es', sv.display_es, 'en', sv.display_en), 'unit', sv.unit_label,
                    'sourcePublishedAt', sv.source_published_at, 'locator', sv.locator, 'valueStatus', sv.value_status) END,
      'card', CASE WHEN u.kind = 'card' THEN jsonb_build_object('cardType', cc.card_type, 'title', jsonb_build_object('es', cc.title_es, 'en', lv.title), 'body', jsonb_build_object('es', cc.body_es, 'en', lv.body),
                    'claims', jsonb_build_object('es', to_jsonb(cc.claims_es), 'en', to_jsonb(lv.claims)), 'normPublishedAt', cc.norm_published_at, 'normEffectiveFrom', cc.norm_effective_from, 'lastReviewedAt', cc.last_reviewed_at) END,
      'source', CASE WHEN pb.id IS NOT NULL THEN jsonb_build_object('publicationKey', pb.key, 'title', pb.title, 'institution', it.name, 'officialUrl', pb.official_url, 'authorityClass', it.authority_class, 'permittedUse', pb.permitted_use) END,
      'validatedOn', (SELECT max(sv2.validated_at)::date FROM kl.specialist_validation sv2 WHERE sv2.unit_version_id = uv.id AND sv2.status = 'valid'))), '{}'::jsonb)
    INTO v_units
    FROM (SELECT x AS ref FROM jsonb_array_elements_text(e.manifest -> 'unitRefs') x) r
    JOIN kl.unit u ON u.unit_key = split_part(r.ref, '@', 1)
    JOIN kl.unit_version uv ON uv.unit_id = u.id AND uv.version = split_part(r.ref, '@', 2)::integer
    LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
    LEFT JOIN kl.indicator ind ON ind.key = sv.indicator_key
    LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
    LEFT JOIN kl.card_locale_variant lv ON lv.unit_version_id = uv.id AND lv.locale = 'en'
    LEFT JOIN kl.publication pb ON pb.id = coalesce(sv.publication_id, cc.primary_source_publication_id)
    LEFT JOIN kl.institution it ON it.id = pb.institution_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sectionKey', ps.section_key, 'chapter', ps.chapter, 'part', ps.part, 'slot', ps.slot, 'order', ps.sort_order, 'contentType', ps.content_type,
      'title', jsonb_build_object('es', ps.title_es, 'en', ps.title_en), 'validationDomain', ps.validation_domain,
      'items', (SELECT coalesce(jsonb_agg(u.unit_key || '@' || uv.version ORDER BY ci.sort_order), '[]'::jsonb)
                  FROM kl.composition_item ci JOIN kl.unit u ON u.id = ci.unit_id JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id WHERE ci.section_id = ps.id)) ORDER BY ps.sort_order, ps.section_key), '[]'::jsonb)
    INTO v_sections FROM kl.product_section ps WHERE ps.product_id = pr.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('blockId', b.block_id, 'version', b.version, 'locale', b.locale, 'content', b.content, 'sha256', b.content_sha256)), '[]'::jsonb) INTO v_fixed
    FROM kl.fixed_block b WHERE b.status = 'approved' AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.manifest -> 'fixedBlocks') m WHERE m ->> 'blockId' = b.block_id AND m ->> 'version' = b.version);
  RETURN jsonb_build_object('edition', jsonb_build_object('id', e.id, 'code', e.code, 'status', e.status, 'productKey', pr.key, 'country', pr.country, 'cutoffDate', e.cutoff_date, 'manifestSha256', e.manifest_sha256,
                            'changeReport', e.change_report, 'nextCycleAt', pr.next_cycle_at, 'reviewPeriodicity', pr.review_periodicity::text), 'manifest', e.manifest, 'units', v_units, 'sections', v_sections, 'fixedBlocks', v_fixed);
END $$;

-- El worker termina el render: guarda ES y EN juntos y publica; si una compuerta dejó de cumplirse durante el render no se publica.
CREATE FUNCTION kl.complete_rendering(p_edition uuid, p_verification_id_sha256 text, p_renderings jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; e kl.edition; pr kl.product; r jsonb; v_failed text; v_fid uuid; v_prev uuid; v_locales text[];
BEGIN
  v_actor := kl.begin_mutation('agent.compile');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition FOR UPDATE;
  IF NOT FOUND OR e.status <> 'rendering' THEN RAISE EXCEPTION 'BV409: la edición no está en render' USING ERRCODE = 'BV409'; END IF;
  SELECT * INTO pr FROM kl.product WHERE id = e.product_id;
  IF p_verification_id_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_renderings) <> 'array' THEN RAISE EXCEPTION 'BV422: datos de render no válidos' USING ERRCODE = 'BV422'; END IF;
  SELECT array_agg(x ->> 'locale' ORDER BY x ->> 'locale') INTO v_locales FROM jsonb_array_elements(p_renderings) x;
  IF v_locales IS DISTINCT FROM ARRAY['en', 'es'] THEN RAISE EXCEPTION 'BV409: una edición se publica con ES y EN juntos' USING ERRCODE = 'BV409'; END IF;
  SELECT string_agg(c.code, ', ' ORDER BY c.code) INTO v_failed FROM kl._edition_controls(p_edition) c WHERE NOT c.ok;
  IF v_failed IS NOT NULL THEN RAISE EXCEPTION 'BV409: compuertas sin cumplir al publicar: %', v_failed USING ERRCODE = 'BV409'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_renderings) LOOP
    IF (r ->> 'pdf_sha256') !~ '^[0-9a-f]{64}$' OR (r ->> 'report_document_sha256') !~ '^[0-9a-f]{64}$' OR (r ->> 'print_html_sha256') !~ '^[0-9a-f]{64}$'
       OR (r ->> 'renderer') !~ '^chromium@' OR coalesce((r ->> 'byte_length')::bigint, 0) <= 0
       OR (r ->> 'storage_key') <> format('kl/editions/%s/%s/%s/%s.pdf', pr.key, e.code, r ->> 'locale', r ->> 'pdf_sha256') THEN
      RAISE EXCEPTION 'BV422: render %: huellas, motor o llave de almacenamiento no válidos', r ->> 'locale' USING ERRCODE = 'BV422';
    END IF;
    INSERT INTO kl.file_object (sha256, detected_type, byte_length, storage_key, scan_result, uploaded_by, purpose)
    VALUES (r ->> 'pdf_sha256', 'pdf', (r ->> 'byte_length')::bigint, r ->> 'storage_key', 'clean', v_actor, 'edition_pdf')
    ON CONFLICT (sha256) DO NOTHING;
    SELECT id INTO v_fid FROM kl.file_object WHERE sha256 = r ->> 'pdf_sha256';
    INSERT INTO kl.edition_rendering (edition_id, locale, report_document_sha256, print_html_sha256, file_object_id, pdf_sha256, renderer, rendered_at)
    VALUES (p_edition, r ->> 'locale', r ->> 'report_document_sha256', r ->> 'print_html_sha256', v_fid, r ->> 'pdf_sha256', r ->> 'renderer', now());
  END LOOP;
  SELECT id INTO v_prev FROM kl.edition WHERE product_id = e.product_id AND status = 'published' AND id <> p_edition;
  IF v_prev IS NOT NULL THEN UPDATE kl.edition SET status = 'superseded', superseded_by = p_edition, updated_at = now() WHERE id = v_prev; END IF;
  UPDATE kl.edition SET status = 'published', published_at = now(), verification_id_sha256 = p_verification_id_sha256, updated_at = now() WHERE id = p_edition;
  PERFORM kl.audit('kl.edition.publish', 'edition', p_edition::text, 'rendering', 'published', pr.key || '@' || e.code);
  PERFORM kl.mutation_off();
END $$;

CREATE FUNCTION kl.fail_rendering(p_edition uuid, p_error_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition;
BEGIN
  PERFORM kl.begin_mutation('agent.compile');
  IF coalesce(p_error_code, '') !~ '^[a-z0-9_]{1,60}$' THEN RAISE EXCEPTION 'BV422: código de error no válido' USING ERRCODE = 'BV422'; END IF;
  SELECT * INTO e FROM kl.edition WHERE id = p_edition FOR UPDATE;
  IF NOT FOUND OR e.status <> 'rendering' THEN RAISE EXCEPTION 'BV409: la edición no está en render' USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.edition SET status = 'in_approval', updated_at = now() WHERE id = p_edition;
  PERFORM kl.audit('kl.edition.render_failed', 'edition', p_edition::text, 'rendering', 'in_approval', p_error_code);
  PERFORM kl.mutation_off();
END $$;

CREATE FUNCTION kl.complete_preview(p_edition uuid, p_locale text, p_pdf_sha256 text, p_byte_length bigint, p_storage_key text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; e kl.edition; v_fid uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('agent.compile');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND OR e.status <> 'in_approval' THEN RAISE EXCEPTION 'BV409: la edición no está en aprobación' USING ERRCODE = 'BV409'; END IF;
  IF p_pdf_sha256 !~ '^[0-9a-f]{64}$' OR p_storage_key !~ '^kl/previews/' OR p_byte_length <= 0 THEN RAISE EXCEPTION 'BV422: datos de vista previa no válidos' USING ERRCODE = 'BV422'; END IF;
  INSERT INTO kl.file_object (sha256, detected_type, byte_length, storage_key, scan_result, uploaded_by, purpose) VALUES (p_pdf_sha256, 'pdf', p_byte_length, p_storage_key, 'clean', v_actor, 'edition_preview') ON CONFLICT (sha256) DO NOTHING;
  SELECT id INTO v_fid FROM kl.file_object WHERE sha256 = p_pdf_sha256;
  INSERT INTO kl.edition_preview (edition_id, locale, manifest_sha256, file_object_id, created_by) VALUES (p_edition, p_locale, e.manifest_sha256, v_fid, v_actor) RETURNING id INTO v_id;
  PERFORM kl.audit('kl.edition.preview_ready', 'edition', p_edition::text, NULL, p_locale, NULL);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.unpublish_edition(p_edition uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.begin_mutation('edition.unpublish');
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'BV422: el motivo es obligatorio' USING ERRCODE = 'BV422'; END IF;
  UPDATE kl.edition SET status = 'unpublished', updated_at = now() WHERE id = p_edition AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'BV409: solo una edición publicada se despublica' USING ERRCODE = 'BV409'; END IF;
  PERFORM kl.audit('kl.edition.unpublish', 'edition', p_edition::text, 'published', 'unpublished', p_reason);
  PERFORM kl.mutation_off();
END $$;

CREATE FUNCTION kl.revoke_edition(p_edition uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.begin_mutation('edition.revoke');
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 500 THEN RAISE EXCEPTION 'BV422: el motivo es obligatorio' USING ERRCODE = 'BV422'; END IF;
  UPDATE kl.edition SET status = 'revoked', revocation_reason = p_reason, updated_at = now() WHERE id = p_edition AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'BV409: solo una edición publicada se revoca' USING ERRCODE = 'BV409'; END IF;
  PERFORM kl.audit('kl.edition.revoke', 'edition', p_edition::text, 'published', 'revoked', p_reason);
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Propagación de retiros e invalidaciones (KL-0003 _withdraw_versions se redefine): además de paquetes y avisos por composición,
-- una edición publicada que cita una versión retirada recibe aviso; las ediciones por aprobar vuelven a composición; las piezas
-- compuestas quedan en revisión.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kl._withdraw_versions(p_version_ids uuid[], p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE kl.unit_version SET status = 'withdrawn' WHERE id = ANY (p_version_ids) AND status IN ('draft', 'in_review', 'awaiting_validation', 'published');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM kl._invalidate_packages(p_version_ids, p_reason);
  INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, kind)
  SELECT DISTINCT ps.product_id, uv.unit_id, uv.id, 'withdrawn'
    FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id JOIN kl.unit_version uv ON uv.unit_id = ci.unit_id
   WHERE uv.id = ANY (p_version_ids) AND uv.status = 'withdrawn'
     AND NOT EXISTS (SELECT 1 FROM kl.change_notice cn WHERE cn.from_version_id = uv.id AND cn.product_id = ps.product_id AND cn.kind = 'withdrawn');
  -- ediciones publicadas que citan la versión: aviso al producto
  INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, kind)
  SELECT DISTINCT ed.product_id, uv.unit_id, uv.id, 'withdrawn'
    FROM kl.edition ed JOIN kl.unit_version uv ON uv.id = ANY (p_version_ids) AND uv.status = 'withdrawn'
    JOIN kl.unit u ON u.id = uv.unit_id
   WHERE ed.status IN ('published', 'rendering', 'in_approval') AND ed.manifest -> 'unitRefs' ? (u.unit_key || '@' || uv.version)
     AND NOT EXISTS (SELECT 1 FROM kl.change_notice cn WHERE cn.from_version_id = uv.id AND cn.product_id = ed.product_id AND cn.kind = 'withdrawn');
  -- ediciones por aprobar con piezas retiradas vuelven a composición (no se aprueba lo que ya no es válido)
  UPDATE kl.edition ed SET status = 'composing', manifest = NULL, manifest_sha256 = NULL, approved_by = NULL, updated_at = now()
   WHERE ed.status = 'in_approval' AND EXISTS (
     SELECT 1 FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE uv.id = ANY (p_version_ids) AND uv.status = 'withdrawn' AND ed.manifest -> 'unitRefs' ? (u.unit_key || '@' || uv.version));
  UPDATE kl.composition_item ci SET status = 'requires_review', pinned_version_id = NULL
   WHERE ci.pinned_version_id = ANY (p_version_ids);
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Jobs atrasados y activación controlada de agentes (cuando se habiliten): sin procesamiento masivo.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.triage_stale_jobs() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_hours integer; v_dup integer; v_inel integer; v_stale integer; v_renewed integer;
BEGIN
  PERFORM kl.begin_mutation('agent.compile');
  v_hours := coalesce((kl._setting('kl.jobs.stale_after_hours') #>> '{}')::integer, 48);
  -- (1) fuentes que ya no son elegibles: lo pendiente no se ejecuta
  UPDATE kl.job j SET status = 'obsolete', error_code = 'source_not_eligible', updated_at = now()
   WHERE j.kind IN ('collect', 'review_now') AND j.status = 'queued'
     AND NOT EXISTS (SELECT 1 FROM kl.publication p WHERE p.key = j.payload ->> 'publication_key' AND p.status = 'approved'
                       AND (j.kind = 'review_now' OR kl.effective_check_frequency(p.id) <> 'none'));
  GET DIAGNOSTICS v_inel = ROW_COUNT;
  -- (2) duplicados: por fuente solo se conserva el pendiente más reciente
  WITH ranked AS (SELECT job_id, row_number() OVER (PARTITION BY payload ->> 'publication_key' ORDER BY created_at DESC, job_id) AS rn FROM kl.job WHERE kind IN ('collect', 'review_now') AND status = 'queued')
  UPDATE kl.job j SET status = 'obsolete', error_code = 'duplicate', updated_at = now() FROM ranked r WHERE j.job_id = r.job_id AND r.rn > 1;
  GET DIAGNOSTICS v_dup = ROW_COUNT;
  -- (3) atrasados: se descartan y la fuente vuelve a quedar «vencida» para que el planificador encole UNO nuevo con la vigencia al día
  WITH stale AS (
    UPDATE kl.job j SET status = 'obsolete', error_code = 'stale', updated_at = now()
     WHERE j.kind = 'collect' AND j.status = 'queued' AND j.created_at < now() - make_interval(hours => v_hours) RETURNING j.payload ->> 'publication_key' AS pub
  ), renew AS (
    UPDATE kl.publication p SET next_check_at = now() FROM stale WHERE p.key = stale.pub AND p.status = 'approved' RETURNING 1
  )
  SELECT (SELECT count(*) FROM stale), (SELECT count(*) FROM renew) INTO v_stale, v_renewed;
  IF v_inel + v_dup + v_stale > 0 THEN
    PERFORM kl.audit('kl.jobs.triage', 'job', NULL, NULL, NULL, v_inel || ' ineligible, ' || v_dup || ' duplicate, ' || v_stale || ' stale');
  END IF;
  PERFORM kl.mutation_off();
  RETURN jsonb_build_object('ineligible', v_inel, 'duplicates', v_dup, 'stale', v_stale, 'renewed', v_renewed);
END $$;

-- claim_jobs (KL-0001) se redefine: los jobs de agentes solo se entregan con kl.agents_enabled (apagado), en lotes acotados y sin
-- los atrasados (esos los descarta kl.triage_stale_jobs). Una activación futura procesa pocos jobs recientes por llamada.
CREATE OR REPLACE FUNCTION kl.claim_jobs(p_kinds text[], p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 300) RETURNS SETOF kl.job
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_is_agent boolean; v_enabled boolean; v_cap integer; v_hours integer;
BEGIN
  v_actor := kl.begin_mutation('job.claim');
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 OR p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'BV422: parámetros de arrendamiento fuera de rango' USING ERRCODE = 'BV422';
  END IF;
  v_is_agent := EXISTS (SELECT 1 FROM kl.role_grant g WHERE g.admin_user_id = v_actor AND g.revoked_at IS NULL AND g.role = 'SERVICE_AGENT');
  v_enabled := coalesce((kl._setting('kl.agents_enabled')) = 'true'::jsonb, false);
  v_hours := coalesce((kl._setting('kl.jobs.stale_after_hours') #>> '{}')::integer, 48);
  v_cap := p_limit;
  IF v_is_agent THEN
    IF NOT v_enabled THEN PERFORM kl.mutation_off(); RETURN; END IF;
    v_cap := least(p_limit, coalesce((kl._setting('kl.agents.max_batch') #>> '{}')::integer, 3));
  END IF;
  UPDATE kl.job j SET status = 'dead', lease_until = NULL, leased_by = NULL, lease_token = NULL, error_code = coalesce(j.error_code, 'lease_expired'), updated_at = now()
   WHERE j.status = 'leased' AND j.lease_until < now() AND j.attempts >= j.max_attempts;
  RETURN QUERY
  WITH picked AS (
    SELECT j.job_id
      FROM kl.job j JOIN kl.job_kind k ON k.kind = j.kind
     WHERE j.kind = ANY (p_kinds)
       AND k.claim_role IN (SELECT g.role FROM kl.role_grant g WHERE g.admin_user_id = v_actor AND g.revoked_at IS NULL)
       AND ((j.status = 'queued' AND j.run_after <= now() AND (k.claim_role <> 'SERVICE_AGENT' OR j.created_at >= now() - make_interval(hours => v_hours)))
         OR (j.status = 'leased' AND j.lease_until < now() AND j.attempts < j.max_attempts))
     ORDER BY (j.kind = 'review_now') DESC, j.run_after, j.created_at
     LIMIT v_cap
       FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE kl.job j
       SET status = 'leased', lease_until = now() + make_interval(secs => p_lease_seconds), leased_by = v_actor, lease_token = gen_random_uuid(), attempts = j.attempts + 1, updated_at = now()
      FROM picked WHERE j.job_id = picked.job_id
    RETURNING j.*
  )
  SELECT * FROM claimed;
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Entradas del manifiesto (una sola fuente de verdad): versiones fijadas, enlaces vigentes y huellas de los bloques fijos.
-- El generador añade tema y fuentes y lo entrega a kl.submit_edition, que lo vuelve a verificar contra estos mismos datos.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.manifest_inputs(p_edition uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE e kl.edition; pr kl.product; v_cfg jsonb; v_links jsonb := '{}'::jsonb; v_fixed jsonb := '[]'::jsonb; l text; fb jsonb; v_sections jsonb; v_refs jsonb;
BEGIN
  PERFORM kl.begin_mutation('content.author');
  SELECT * INTO e FROM kl.edition WHERE id = p_edition;
  IF NOT FOUND OR e.status <> 'composing' THEN RAISE EXCEPTION 'BV409: la edición no está en composición' USING ERRCODE = 'BV409'; END IF;
  SELECT * INTO pr FROM kl.product WHERE id = e.product_id;
  PERFORM kl._refresh_pins(pr.id);
  v_cfg := kl._setting('kl.product.' || pr.key || '.config');
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'BV409: el producto no tiene configuración' USING ERRCODE = 'BV409'; END IF;
  FOR l IN SELECT jsonb_array_elements_text(v_cfg -> 'links') LOOP
    v_links := v_links || jsonb_build_object(l, kl._setting(l) #>> '{}');
  END LOOP;
  FOR fb IN SELECT * FROM jsonb_array_elements(v_cfg -> 'fixedBlocks') LOOP
    v_fixed := v_fixed || jsonb_build_array(jsonb_build_object('blockId', fb ->> 'blockId', 'version', fb ->> 'version',
      'sha256_es', (SELECT content_sha256 FROM kl.fixed_block WHERE block_id = fb ->> 'blockId' AND version = fb ->> 'version' AND locale = 'es' AND status = 'approved'),
      'sha256_en', (SELECT content_sha256 FROM kl.fixed_block WHERE block_id = fb ->> 'blockId' AND version = fb ->> 'version' AND locale = 'en' AND status = 'approved')));
  END LOOP;
  SELECT coalesce(jsonb_agg(u.unit_key || '@' || uv.version ORDER BY u.unit_key), '[]'::jsonb) INTO v_refs
    FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id AND ps.product_id = pr.id JOIN kl.unit u ON u.id = ci.unit_id JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sectionKey', ps.section_key, 'chapter', ps.chapter, 'titleEs', ps.title_es, 'titleEn', ps.title_en, 'categoryKeys', to_jsonb(ps.category_keys), 'unitRefs',
      (SELECT coalesce(jsonb_agg(u.unit_key || '@' || uv.version ORDER BY ci.sort_order), '[]'::jsonb) FROM kl.composition_item ci JOIN kl.unit u ON u.id = ci.unit_id JOIN kl.unit_version uv ON uv.id = ci.pinned_version_id WHERE ci.section_id = ps.id))
      ORDER BY ps.sort_order, ps.section_key), '[]'::jsonb) INTO v_sections FROM kl.product_section ps WHERE ps.product_id = pr.id;
  PERFORM kl.mutation_off();
  RETURN jsonb_build_object('theme', 'db.v3b', 'locales', jsonb_build_array('es', 'en'), 'links', v_links, 'fixedBlocks', v_fixed, 'unitRefs', v_refs, 'sections', v_sections, 'cutoffDate', e.cutoff_date);
END $$;

-- Ubicación de una vista previa para su descarga autenticada de revisión (no es distribución).
CREATE FUNCTION kl.preview_file(p_edition uuid, p_locale text) RETURNS TABLE (storage_key text, sha256 text, byte_length bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.require('kl.read');
  RETURN QUERY SELECT fo.storage_key, fo.sha256, fo.byte_length FROM kl.edition_preview p JOIN kl.file_object fo ON fo.id = p.file_object_id
    JOIN kl.edition e ON e.id = p.edition_id WHERE p.edition_id = p_edition AND p.locale = p_locale AND p.manifest_sha256 = e.manifest_sha256 ORDER BY p.created_at DESC LIMIT 1;
END $$;
