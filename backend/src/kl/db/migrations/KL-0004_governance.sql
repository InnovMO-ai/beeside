-- KL-0004 · R2: gobierno y operación interna. Periodicidad (PO-6, Design Spec §5.9), planificador sobre kl.job sin consultas
-- externas, acciones auditadas «Revisar ahora» y «Edición extraordinaria», vencimiento de validaciones, validadores,
-- protección contra quedarse sin KL_ADMIN y correlación de auditoría (B5, X30). No modifica KL-0001..KL-0003: las funciones
-- que cambian se redefinen aquí (CREATE OR REPLACE) y la historia de migraciones queda intacta.

CREATE TABLE kl.audit_correlation_report (
  report_id               bigserial PRIMARY KEY,
  run_at                  timestamptz NOT NULL DEFAULT now(),
  window_from             timestamptz NOT NULL,
  window_to               timestamptz NOT NULL,
  kl_events_checked       integer NOT NULL CHECK (kl_events_checked >= 0),
  platform_events_checked integer NOT NULL CHECK (platform_events_checked >= 0),
  kl_only                 jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(kl_only) = 'array'),
  admin_only              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(admin_only) = 'array'),
  status                  text NOT NULL CHECK (status IN ('clean', 'discrepancies')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correlation_window_order CHECK (window_to > window_from),
  CONSTRAINT correlation_status_matches CHECK ((status = 'clean') = (jsonb_array_length(kl_only) = 0 AND jsonb_array_length(admin_only) = 0))
);
CREATE INDEX audit_correlation_window_idx ON kl.audit_correlation_report (window_to DESC);

-- ---------------------------------------------------------------------------------------------------------------
-- Calendario de periodicidad (America/Mexico_City). `none` no programa nada. No existe valor diario.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.next_due(p_base timestamptz, p_cadence kl.cadence) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = kl, pg_temp AS $$
  SELECT CASE p_cadence
    WHEN 'weekly'     THEN ((p_base AT TIME ZONE 'America/Mexico_City') + interval '7 days') AT TIME ZONE 'America/Mexico_City'
    WHEN 'monthly'    THEN ((p_base AT TIME ZONE 'America/Mexico_City') + interval '1 month') AT TIME ZONE 'America/Mexico_City'
    WHEN 'quarterly'  THEN ((p_base AT TIME ZONE 'America/Mexico_City') + interval '3 months') AT TIME ZONE 'America/Mexico_City'
    WHEN 'semiannual' THEN ((p_base AT TIME ZONE 'America/Mexico_City') + interval '6 months') AT TIME ZONE 'America/Mexico_City'
    WHEN 'annual'     THEN ((p_base AT TIME ZONE 'America/Mexico_City') + interval '12 months') AT TIME ZONE 'America/Mexico_City'
    ELSE NULL END;
$$;

-- Periodicidad efectiva de una fuente. Un valor propio manda; `inherit` toma la periodicidad más frecuente de los productos
-- que citan unidades de esa fuente y, si hay un paquete de RAM activo que las usa, la cadencia de RAM configurada
-- (kl.ram.check_cadence, `none` por defecto: la RAM no obliga a consultar hasta que KL_ADMIN lo decida). Sin consumidores: none.
CREATE FUNCTION kl.effective_check_frequency(p_publication_id uuid) RETURNS kl.cadence
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_own text; v_best kl.cadence; v_ram kl.cadence; v_ram_used boolean;
BEGIN
  SELECT check_frequency INTO v_own FROM kl.publication WHERE id = p_publication_id;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF v_own <> 'inherit' THEN RETURN v_own::kl.cadence; END IF;
  WITH versions AS (
    SELECT uv.id, uv.unit_id FROM kl.unit_version uv
      LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
      LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
     WHERE uv.status = 'published' AND (sv.publication_id = p_publication_id OR cc.primary_source_publication_id = p_publication_id)
  )
  SELECT min(pr.review_periodicity) FILTER (WHERE pr.review_periodicity <> 'none') INTO v_best
    FROM kl.composition_item ci
    JOIN kl.product_section ps ON ps.id = ci.section_id
    JOIN kl.product pr ON pr.id = ps.product_id
   WHERE ci.unit_id IN (SELECT unit_id FROM versions);
  SELECT EXISTS (
    SELECT 1 FROM kl.package_member pm JOIN kl.context_package cp ON cp.id = pm.package_id AND cp.status = 'active'
     WHERE pm.unit_version_id IN (SELECT uv.id FROM kl.unit_version uv
                                    LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
                                    LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
                                   WHERE sv.publication_id = p_publication_id OR cc.primary_source_publication_id = p_publication_id)
  ) INTO v_ram_used;
  IF v_ram_used THEN
    v_ram := coalesce(trim(both '"' from (kl._setting('kl.ram.check_cadence'))::text), 'none')::kl.cadence;
    IF v_ram <> 'none' AND (v_best IS NULL OR v_ram < v_best) THEN v_best := v_ram; END IF;
  END IF;
  RETURN coalesce(v_best, 'none');
END $$;

-- Inserción en la cola sin autorización propia: solo la invocan funciones que ya autorizaron.
CREATE FUNCTION kl._enqueue(p_kind text, p_payload jsonb, p_requested_by uuid, p_run_after timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE jk kl.job_kind; v_id uuid;
BEGIN
  SELECT * INTO jk FROM kl.job_kind WHERE kind = p_kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV422: tipo de job desconocido' USING ERRCODE = 'BV422'; END IF;
  INSERT INTO kl.job (kind, payload, run_after, max_attempts, requested_by) VALUES (p_kind, p_payload, coalesce(p_run_after, now()), jk.max_attempts, p_requested_by) RETURNING job_id INTO v_id;
  RETURN v_id;
END $$;

-- enqueue_job (KL-0001) se redefine: `collect` ya no se encola a mano; solo el planificador o una acción manual auditada
-- («Revisar ahora» → review_now) pueden poner en marcha una consulta (ningún agente corre fuera de next_*_at).
CREATE OR REPLACE FUNCTION kl.enqueue_job(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_run_after timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE jk kl.job_kind; v_actor uuid; v_job uuid;
BEGIN
  SELECT * INTO jk FROM kl.job_kind WHERE kind = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BV422: tipo de job desconocido' USING ERRCODE = 'BV422';
  END IF;
  v_actor := kl.begin_mutation(jk.enqueue_permission);
  IF p_kind IN ('collect', 'extraordinary_edition') THEN
    RAISE EXCEPTION 'BV403: el tipo % solo se encola desde su función auditada', p_kind USING ERRCODE = 'BV403';
  END IF;
  IF NOT kl.job_payload_ok(p_kind, coalesce(p_payload, '{}'::jsonb)) THEN
    RAISE EXCEPTION 'BV422: payload fuera de la lista blanca del tipo %', p_kind USING ERRCODE = 'BV422';
  END IF;
  v_job := kl._enqueue(p_kind, coalesce(p_payload, '{}'::jsonb), v_actor, p_run_after);
  PERFORM kl.audit('kl.job.enqueue', 'job', v_job::text, NULL, 'queued', p_kind);
  PERFORM kl.mutation_off();
  RETURN v_job;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Productos y periodicidad (solo KL_ADMIN; cada cambio crea versión de configuración y evento de auditoría)
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.create_product(p_key text, p_country text, p_review_periodicity kl.cadence DEFAULT 'semiannual') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  INSERT INTO kl.product (key, kind, country, master_locale, review_periodicity, next_cycle_at)
  VALUES (p_key, 'guide', p_country, 'es', p_review_periodicity, kl.next_due(now(), p_review_periodicity)) RETURNING id INTO v_id;
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES ('kl.product_cadence.' || p_key, 1, to_jsonb(p_review_periodicity::text), 'create_product', v_actor);
  PERFORM kl.audit('kl.product.create', 'product', v_id::text, NULL, p_review_periodicity::text, p_key);
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

CREATE FUNCTION kl.set_product_periodicity(p_key text, p_cadence kl.cadence, p_reason text DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; pr kl.product; v_next integer; v_due timestamptz;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  SELECT * INTO pr FROM kl.product WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
  IF pr.review_periodicity = p_cadence THEN RAISE EXCEPTION 'BV409: la periodicidad ya es %', p_cadence USING ERRCODE = 'BV409'; END IF;
  v_due := kl.next_due(now(), p_cadence);
  UPDATE kl.product SET review_periodicity = p_cadence, next_cycle_at = v_due WHERE id = pr.id;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = 'kl.product_cadence.' || p_key;
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES ('kl.product_cadence.' || p_key, v_next, to_jsonb(p_cadence::text), left(p_reason, 200), v_actor);
  PERFORM kl.audit('kl.product.periodicity', 'product', pr.id::text, pr.review_periodicity::text, p_cadence::text, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_due;
END $$;

CREATE FUNCTION kl.set_publication_frequency(p_key text, p_frequency text, p_reason text DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; pub kl.publication; v_next integer; v_eff kl.cadence; v_due timestamptz;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  IF p_frequency IS NULL OR p_frequency NOT IN ('inherit', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'none') THEN
    RAISE EXCEPTION 'BV422: frecuencia no válida (no existe valor diario)' USING ERRCODE = 'BV422';
  END IF;
  SELECT * INTO pub FROM kl.publication WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: publicación inexistente' USING ERRCODE = 'BV404'; END IF;
  IF pub.status IN ('revoked', 'rejected', 'discontinued') THEN RAISE EXCEPTION 'BV409: una fuente % no se programa', pub.status USING ERRCODE = 'BV409'; END IF;
  IF pub.check_frequency = p_frequency THEN RAISE EXCEPTION 'BV409: la frecuencia ya es %', p_frequency USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.publication SET check_frequency = p_frequency, updated_at = now() WHERE id = pub.id;
  v_eff := kl.effective_check_frequency(pub.id);
  v_due := CASE WHEN pub.status = 'approved' THEN kl.next_due(now(), v_eff) ELSE NULL END;
  UPDATE kl.publication SET next_check_at = v_due WHERE id = pub.id;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.publication_config_version WHERE publication_id = pub.id;
  INSERT INTO kl.publication_config_version (publication_id, version, config, authored_by)
  VALUES (pub.id, v_next, jsonb_build_object('check_frequency', p_frequency, 'effective', v_eff::text, 'reason', left(p_reason, 200)), v_actor);
  PERFORM kl.audit('kl.publication.frequency', 'publication', pub.id::text, pub.check_frequency, p_frequency, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_due;
END $$;

-- Cadencia de RAM (la RAM puede obligar a revisar las fuentes que usa, solo si KL_ADMIN lo decide).
CREATE FUNCTION kl.set_ram_cadence(p_cadence kl.cadence, p_reason text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_next integer;
BEGIN
  v_actor := kl.begin_mutation('settings.write');
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM kl.setting_version WHERE key = 'kl.ram.check_cadence';
  INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES ('kl.ram.check_cadence', v_next, to_jsonb(p_cadence::text), left(p_reason, 200), v_actor);
  PERFORM kl.audit('kl.ram.cadence', 'setting', 'kl.ram.check_cadence', NULL, p_cadence::text, p_reason);
  PERFORM kl.mutation_off();
  RETURN v_next;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Acciones manuales auditadas
-- ---------------------------------------------------------------------------------------------------------------
-- «Revisar ahora» (KL_EDITOR o KL_ADMIN): encola un review_now por fuente aprobada; si ya hay uno pendiente, lo reutiliza.
CREATE FUNCTION kl.check_now(p_target text, p_key text, p_reason text) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_pubs text[]; v_key text; v_ids uuid[] := '{}'; v_job uuid; v_new integer := 0; v_ent uuid;
BEGIN
  v_actor := kl.begin_mutation('job.enqueue');
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 300 THEN
    RAISE EXCEPTION 'BV422: el motivo (3 a 300 caracteres) es obligatorio' USING ERRCODE = 'BV422';
  END IF;
  IF p_target = 'publication' THEN
    SELECT id, array[key] INTO v_ent, v_pubs FROM kl.publication WHERE key = p_key AND status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'BV409: solo se revisa una fuente aprobada' USING ERRCODE = 'BV409'; END IF;
  ELSIF p_target = 'product' THEN
    SELECT id INTO v_ent FROM kl.product WHERE key = p_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
    SELECT coalesce(array_agg(DISTINCT p.key ORDER BY p.key), '{}') INTO v_pubs
      FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id
      JOIN kl.unit_version uv ON uv.unit_id = ci.unit_id AND uv.status = 'published'
      LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
      LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
      JOIN kl.publication p ON p.id = coalesce(sv.publication_id, cc.primary_source_publication_id) AND p.status = 'approved'
     WHERE ps.product_id = v_ent;
    IF cardinality(v_pubs) = 0 THEN RAISE EXCEPTION 'BV409: el producto no cita fuentes aprobadas' USING ERRCODE = 'BV409'; END IF;
  ELSE
    RAISE EXCEPTION 'BV422: objetivo no válido' USING ERRCODE = 'BV422';
  END IF;
  FOREACH v_key IN ARRAY v_pubs LOOP
    SELECT job_id INTO v_job FROM kl.job WHERE kind = 'review_now' AND payload ->> 'publication_key' = v_key AND status IN ('queued', 'leased') LIMIT 1;
    IF NOT FOUND THEN
      v_job := kl._enqueue('review_now', jsonb_build_object('publication_key', v_key), v_actor);
      v_new := v_new + 1;
    END IF;
    v_ids := v_ids || v_job;
  END LOOP;
  PERFORM kl.audit('kl.check_now', p_target, v_ent::text, NULL, v_new || ' new / ' || (cardinality(v_ids) - v_new) || ' reused', p_reason);
  PERFORM kl.mutation_off();
  RETURN v_ids;
END $$;

-- «Edición extraordinaria» (solo KL_ADMIN). La consume R3; aquí queda encolada y auditada con su motivo.
CREATE FUNCTION kl.extraordinary_edition(p_product_key text, p_reason_code text, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_prod uuid; v_job uuid;
BEGIN
  v_actor := kl.begin_mutation('job.enqueue_extraordinary');
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 300 OR coalesce(p_reason_code, '') !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION 'BV422: código y motivo son obligatorios' USING ERRCODE = 'BV422';
  END IF;
  SELECT id INTO v_prod FROM kl.product WHERE key = p_product_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: producto inexistente' USING ERRCODE = 'BV404'; END IF;
  IF EXISTS (SELECT 1 FROM kl.job WHERE kind = 'extraordinary_edition' AND payload ->> 'product_key' = p_product_key AND status IN ('queued', 'leased')) THEN
    RAISE EXCEPTION 'BV409: ya hay una edición extraordinaria pendiente para este producto' USING ERRCODE = 'BV409';
  END IF;
  v_job := kl._enqueue('extraordinary_edition', jsonb_build_object('product_key', p_product_key, 'reason_code', p_reason_code), v_actor);
  PERFORM kl.audit('kl.extraordinary_edition', 'product', v_prod::text, NULL, 'queued', p_reason_code || ': ' || p_reason);
  PERFORM kl.mutation_off();
  RETURN v_job;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Planificador (kl-knowledge): programa por calendario y encola jobs; nunca consulta nada externo. Una fuente solo se
-- programa si está aprobada y su periodicidad efectiva no es `none`; revocada, suspendida o descontinuada nunca se programa.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.plan_due() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; pub record; prod record; v_eff kl.cadence; v_init integer := 0; v_pubs integer := 0; v_prods integer := 0; v_key text; v_cleared integer := 0;
BEGIN
  v_actor := kl.begin_mutation('job.enqueue_system');
  -- Fuentes no programables pierden su fecha; las nuevas la reciben sin disparar una consulta inmediata.
  FOR pub IN SELECT id, key, status, next_check_at FROM kl.publication WHERE status = 'approved' OR next_check_at IS NOT NULL ORDER BY key FOR UPDATE SKIP LOCKED LOOP
    v_eff := CASE WHEN pub.status = 'approved' THEN kl.effective_check_frequency(pub.id) ELSE 'none'::kl.cadence END;
    IF v_eff = 'none' THEN
      IF pub.next_check_at IS NOT NULL THEN UPDATE kl.publication SET next_check_at = NULL WHERE id = pub.id; v_cleared := v_cleared + 1; END IF;
    ELSIF pub.next_check_at IS NULL THEN
      UPDATE kl.publication SET next_check_at = kl.next_due(now(), v_eff) WHERE id = pub.id; v_init := v_init + 1;
    ELSIF pub.next_check_at <= now() THEN
      IF NOT EXISTS (SELECT 1 FROM kl.job WHERE kind = 'collect' AND payload ->> 'publication_key' = pub.key AND status IN ('queued', 'leased')) THEN
        PERFORM kl._enqueue('collect', jsonb_build_object('publication_key', pub.key), v_actor);
        v_pubs := v_pubs + 1;
      END IF;
      UPDATE kl.publication SET next_check_at = kl.next_due(now(), v_eff) WHERE id = pub.id;
    END IF;
  END LOOP;
  -- Ciclo de producto: una sola revisión de las fuentes que cita, luego la fecha avanza.
  FOR prod IN SELECT id, key, review_periodicity, next_cycle_at FROM kl.product ORDER BY key FOR UPDATE SKIP LOCKED LOOP
    IF prod.review_periodicity = 'none' THEN
      IF prod.next_cycle_at IS NOT NULL THEN UPDATE kl.product SET next_cycle_at = NULL WHERE id = prod.id; END IF;
    ELSIF prod.next_cycle_at IS NULL THEN
      UPDATE kl.product SET next_cycle_at = kl.next_due(now(), prod.review_periodicity) WHERE id = prod.id; v_init := v_init + 1;
    ELSIF prod.next_cycle_at <= now() THEN
      FOR v_key IN
        SELECT DISTINCT p.key FROM kl.composition_item ci JOIN kl.product_section ps ON ps.id = ci.section_id
          JOIN kl.unit_version uv ON uv.unit_id = ci.unit_id AND uv.status = 'published'
          LEFT JOIN kl.stat_value sv ON sv.unit_version_id = uv.id
          LEFT JOIN kl.card_content cc ON cc.unit_version_id = uv.id
          JOIN kl.publication p ON p.id = coalesce(sv.publication_id, cc.primary_source_publication_id) AND p.status = 'approved'
         WHERE ps.product_id = prod.id ORDER BY 1 LOOP
        IF NOT EXISTS (SELECT 1 FROM kl.job WHERE kind = 'collect' AND payload ->> 'publication_key' = v_key AND status IN ('queued', 'leased')) THEN
          PERFORM kl._enqueue('collect', jsonb_build_object('publication_key', v_key), v_actor);
          v_prods := v_prods + 1;
        END IF;
      END LOOP;
      UPDATE kl.product SET next_cycle_at = kl.next_due(now(), prod.review_periodicity) WHERE id = prod.id;
    END IF;
  END LOOP;
  IF v_pubs + v_prods > 0 THEN
    PERFORM kl.audit('kl.planner.tick', 'planner', NULL, NULL, NULL, v_pubs || ' publication jobs, ' || v_prods || ' product-cycle jobs');
  END IF;
  PERFORM kl.mutation_off();
  RETURN jsonb_build_object('initialized', v_init, 'cleared', v_cleared, 'publicationJobs', v_pubs, 'productCycleJobs', v_prods);
END $$;

-- Validaciones: aviso 30 días antes y vencimiento. Lo vencido marca requires_review, invalida paquetes y avisa a los productos.
CREATE FUNCTION kl.expire_validations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_warned integer; v_expired integer; v_ids uuid[];
BEGIN
  PERFORM kl.begin_mutation('agent.compile');
  WITH due AS (
    SELECT sv.unit_version_id, uv.unit_id FROM kl.specialist_validation sv JOIN kl.unit_version uv ON uv.id = sv.unit_version_id
     WHERE sv.status = 'valid' AND sv.verdict = 'approved' AND sv.expires_at > now() AND sv.expires_at <= now() + interval '30 days' AND uv.status = 'published'
  ), ins AS (
    INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, kind)
    SELECT DISTINCT ps.product_id, d.unit_id, d.unit_version_id, 'validation_expiring'
      FROM due d JOIN kl.composition_item ci ON ci.unit_id = d.unit_id JOIN kl.product_section ps ON ps.id = ci.section_id
     WHERE NOT EXISTS (SELECT 1 FROM kl.change_notice n WHERE n.from_version_id = d.unit_version_id AND n.kind = 'validation_expiring' AND n.product_id = ps.product_id)
    RETURNING 1
  ) SELECT count(*) INTO v_warned FROM ins;
  SELECT array_agg(sv.unit_version_id) INTO v_ids FROM kl.specialist_validation sv WHERE sv.status = 'valid' AND sv.expires_at <= now();
  v_expired := coalesce(cardinality(v_ids), 0);
  IF v_expired > 0 THEN
    UPDATE kl.specialist_validation SET status = 'expired' WHERE status = 'valid' AND expires_at <= now();
    UPDATE kl.unit_version SET requires_review = true WHERE id = ANY (v_ids) AND status = 'published';
    PERFORM kl._invalidate_packages(v_ids, 'specialist validation expired');
    INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, kind)
    SELECT DISTINCT ps.product_id, uv.unit_id, uv.id, 'validation_expiring'
      FROM kl.unit_version uv JOIN kl.composition_item ci ON ci.unit_id = uv.unit_id JOIN kl.product_section ps ON ps.id = ci.section_id
     WHERE uv.id = ANY (v_ids) AND NOT EXISTS (SELECT 1 FROM kl.change_notice n WHERE n.from_version_id = uv.id AND n.kind = 'validation_expiring' AND n.product_id = ps.product_id);
  END IF;
  IF v_warned + v_expired > 0 THEN
    PERFORM kl.audit('kl.validation.maintenance', 'specialist_validation', NULL, NULL, NULL, v_warned || ' warned, ' || v_expired || ' expired');
  END IF;
  PERFORM kl.mutation_off();
  RETURN jsonb_build_object('warned', v_warned, 'expired', v_expired);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Gobierno: validadores (la imposibilidad de quedarse sin KL_ADMIN ya la garantiza la regla de KL-0001: nadie se revoca a sí mismo,
-- y solo otro KL_ADMIN activo puede revocar a un KL_ADMIN)
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.set_validator_status(p_id uuid, p_status text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v kl.validator;
BEGIN
  PERFORM kl.begin_mutation('settings.write');
  IF p_status NOT IN ('active', 'inactive') THEN RAISE EXCEPTION 'BV422: estado no válido' USING ERRCODE = 'BV422'; END IF;
  SELECT * INTO v FROM kl.validator WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BV404: validador inexistente' USING ERRCODE = 'BV404'; END IF;
  IF v.status = p_status THEN RAISE EXCEPTION 'BV409: el validador ya está %', p_status USING ERRCODE = 'BV409'; END IF;
  UPDATE kl.validator SET status = p_status WHERE id = p_id;
  PERFORM kl.audit('kl.validator.status', 'validator', p_id::text, v.status, p_status, p_reason);
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Correlación de auditoría (B5, X30). La corre el backend (kl_app) sin certificación de persona: lee la instantánea de
-- request_id de KL, la compara con admin_audit_event y registra el reporte. Nunca corrige ni borra nada.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.correlation_snapshot(p_from timestamptz, p_to timestamptz) RETURNS TABLE (request_id uuid, actions text[], first_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = kl, pg_temp AS $$
  -- Solo eventos de una petición humana (con session_ref) o el arranque de KL_ADMIN: los de cuentas de servicio no tienen par.
  SELECT e.request_id, array_agg(DISTINCT e.action ORDER BY e.action), min(e.at)
    FROM kl.audit_event e
   WHERE e.request_id IS NOT NULL AND e.at >= p_from AND e.at < p_to AND (e.session_ref IS NOT NULL OR e.action = 'kl.bootstrap_admin')
   GROUP BY e.request_id;
$$;

CREATE FUNCTION kl.last_correlation_window() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = kl, pg_temp AS $$ SELECT max(window_to) FROM kl.audit_correlation_report; $$;

CREATE FUNCTION kl.record_correlation_report(p_from timestamptz, p_to timestamptz, p_kl_checked integer, p_platform_checked integer, p_kl_only jsonb, p_admin_only jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_last timestamptz; v_id bigint;
BEGIN
  IF p_to > now() OR p_from >= p_to OR jsonb_typeof(p_kl_only) <> 'array' OR jsonb_typeof(p_admin_only) <> 'array' THEN
    RAISE EXCEPTION 'BV422: ventana o reporte no válidos' USING ERRCODE = 'BV422';
  END IF;
  SELECT max(window_to) INTO v_last FROM kl.audit_correlation_report;
  IF v_last IS NOT NULL AND p_from < v_last THEN
    RAISE EXCEPTION 'BV409: la ventana se traslapa con un reporte anterior' USING ERRCODE = 'BV409';
  END IF;
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  INSERT INTO kl.audit_correlation_report (window_from, window_to, kl_events_checked, platform_events_checked, kl_only, admin_only, status)
  VALUES (p_from, p_to, p_kl_checked, p_platform_checked, p_kl_only, p_admin_only,
          CASE WHEN jsonb_array_length(p_kl_only) = 0 AND jsonb_array_length(p_admin_only) = 0 THEN 'clean' ELSE 'discrepancies' END)
  RETURNING report_id INTO v_id;
  PERFORM kl.mutation_off();
  RETURN v_id;
END $$;

-- Visibilidad de la cola de validación: lectura completa, o solo su dominio para un SPECIALIST_VALIDATOR.
CREATE FUNCTION kl.queue_visible(p_domain text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM kl.require('kl.read');
    RETURN true;
  EXCEPTION WHEN SQLSTATE 'BV403' THEN NULL;
  END;
  IF p_domain IS NULL THEN RETURN false; END IF;
  BEGIN
    PERFORM kl.require('kl.read_own_queue', p_domain);
    RETURN true;
  EXCEPTION WHEN SQLSTATE 'BV403' THEN
    RETURN false;
  END;
END $$;

-- Correr la correlación a mano exige settings.write (KL_ADMIN) y deja su propio evento de auditoría (así su acceso tiene par en KL).
CREATE FUNCTION kl.begin_correlation_run() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.begin_mutation('settings.write');
  PERFORM kl.audit('kl.audit_correlation.run', 'audit_correlation', NULL, NULL, NULL, 'manual run');
  PERFORM kl.mutation_off();
END $$;
