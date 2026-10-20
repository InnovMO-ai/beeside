-- KL-0001 · Integridad: solo inserción, funciones de identidad, certificación, autorización, concesión de roles,
-- arranque auditado de KL_ADMIN y cola, más los permisos de ejecución por rol (CR-KL-002 §2–§8).

-- Tablas de solo inserción o de catálogo inmutable (incluso para el dueño).
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.request_attestation FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.audit_event FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.permission_role FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();
CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.job_kind FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();

-- ---------------------------------------------------------------------------------------------------------------
-- Payload de jobs: lista blanca de claves por tipo; valores escalares cortos y sin texto libre.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.job_payload_ok(p_kind text, p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = kl, pg_temp AS $$
DECLARE allowed text[]; e record;
BEGIN
  SELECT allowed_keys INTO allowed FROM kl.job_kind WHERE kind = p_kind;
  IF NOT FOUND OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN false; END IF;
  FOR e IN SELECT key, value FROM jsonb_each(p_payload) LOOP
    IF NOT (e.key = ANY (allowed)) THEN RETURN false; END IF;
    IF jsonb_typeof(e.value) = 'string' THEN
      IF (e.value #>> '{}') !~ '^[A-Za-z0-9_.:@#-]{1,120}$' THEN RETURN false; END IF;
    ELSIF jsonb_typeof(e.value) NOT IN ('number', 'boolean') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION kl.guard_job_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
BEGIN
  IF NOT kl.job_payload_ok(NEW.kind, NEW.payload) THEN
    RAISE EXCEPTION 'kl.job: payload fuera de la lista blanca del tipo %', NEW.kind USING ERRCODE = 'BV422';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_job_payload BEFORE INSERT ON kl.job FOR EACH ROW EXECUTE FUNCTION kl.guard_job_payload();

-- ---------------------------------------------------------------------------------------------------------------
-- B2 · kl.require: principal activo + certificación de ESTA transacción + concesión vigente (+ dominio).
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.require(p_permission text, p_domain text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE a kl.request_attestation; pr kl.principal; v_service boolean; v_human boolean; v_ok boolean;
BEGIN
  SELECT * INTO a FROM kl.request_attestation WHERE txid = txid_current() AND attested_at = now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BV403: sin certificación de esta transacción' USING ERRCODE = 'BV403';
  END IF;
  SELECT * INTO pr FROM kl.principal WHERE principal_id = a.principal_id;
  IF NOT FOUND OR NOT pr.active THEN
    RAISE EXCEPTION 'BV403: principal inactivo' USING ERRCODE = 'BV403';
  END IF;
  SELECT coalesce(bool_or(role LIKE 'SERVICE\_%'), false), coalesce(bool_or(role NOT LIKE 'SERVICE\_%'), false)
    INTO v_service, v_human FROM kl.permission_role WHERE permission = p_permission;
  IF NOT v_service AND NOT v_human THEN
    RAISE EXCEPTION 'BV403: permiso desconocido %', p_permission USING ERRCODE = 'BV403';
  END IF;
  -- Los permisos humanos exigen admin_user y los de agente exigen service: ningún service aprueba, valida, concede, revoca ni publica.
  IF (v_human AND pr.kind <> 'admin_user') OR (v_service AND pr.kind <> 'service') THEN
    RAISE EXCEPTION 'BV403: el tipo de principal no corresponde al permiso %', p_permission USING ERRCODE = 'BV403';
  END IF;
  -- Solo lectura de SUPERVISOR: sale del platform_role certificado, nunca de una concesión.
  IF a.platform_role = 'SUPERVISOR' AND EXISTS (SELECT 1 FROM kl.permission_role WHERE permission = p_permission AND role = 'SUPERVISOR') THEN
    RETURN pr.principal_id;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM kl.role_grant g
      JOIN kl.permission_role pm
        ON pm.permission = p_permission
       AND (pm.role = g.role OR (pm.role = 'KL_REVIEWER_EDITORIAL' AND g.role = 'KL_REVIEWER' AND g.editorial))
     WHERE g.admin_user_id = pr.principal_id
       AND g.revoked_at IS NULL
       AND g.granted_at <= now()
       AND (NOT pm.requires_domain OR (p_domain IS NOT NULL AND p_domain = ANY (g.domains)))
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'BV403: sin concesión vigente para % (dominio %)', p_permission, coalesce(p_domain, '-') USING ERRCODE = 'BV403';
  END IF;
  RETURN pr.principal_id;
END $$;

-- require + mutación autorizada: lo primero que hace toda función de mutación.
CREATE FUNCTION kl.begin_mutation(p_permission text, p_domain text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := kl.require(p_permission, p_domain);
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  RETURN v_actor;
END $$;

-- Versión no excepcional para las vistas de lectura de administración.
CREATE FUNCTION kl.can_read() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
BEGIN
  PERFORM kl.require('kl.read');
  RETURN true;
EXCEPTION WHEN SQLSTATE 'BV403' THEN
  RETURN false;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B3 · Certificación
-- ---------------------------------------------------------------------------------------------------------------
-- Personas (kl_app): el backend ya resolvió la sesión del Control Center en la base principal, sin caché.
-- Devuelve 'ok' o 'identity_mismatch'; en el segundo caso no emite certificación (kl.require fallará) y deja el
-- evento kl.identity_mismatch, que se confirma con la transacción.
CREATE FUNCTION kl.attest(p_principal_id uuid, p_auth_identity text, p_platform_role text, p_session_ref text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_ident text := lower(btrim(coalesce(p_auth_identity, ''))); pr kl.principal; v_other uuid; v_rows integer;
BEGIN
  IF p_principal_id IS NULL OR v_ident = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'BV403: certificación incompleta' USING ERRCODE = 'BV403';
  END IF;
  IF p_platform_role IS NULL OR p_platform_role NOT IN ('ADMIN', 'SUPERVISOR') THEN
    RAISE EXCEPTION 'BV403: rol de plataforma no válido' USING ERRCODE = 'BV403';
  END IF;
  IF p_session_ref IS NULL OR p_session_ref !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'BV403: referencia de sesión no válida' USING ERRCODE = 'BV403';
  END IF;
  IF v_ident LIKE '%@beeside.internal' THEN
    RAISE EXCEPTION 'BV403: una identidad técnica no se certifica como persona' USING ERRCODE = 'BV403';
  END IF;
  IF EXISTS (SELECT 1 FROM kl.request_attestation WHERE txid = txid_current()) THEN
    RAISE EXCEPTION 'BV403: una sola certificación por transacción' USING ERRCODE = 'BV403';
  END IF;

  -- Sin bloqueo de fila: las peticiones concurrentes de una misma persona (o de varios workers) no se serializan.
  SELECT * INTO pr FROM kl.principal WHERE principal_id = p_principal_id;
  IF NOT FOUND THEN
    SELECT principal_id INTO v_other FROM kl.principal WHERE auth_identity = v_ident;
    IF FOUND THEN
      PERFORM kl.audit('kl.identity_mismatch', 'principal', v_other::text, NULL, NULL, 'identity_in_use', v_other, p_request_id);
      RETURN 'identity_mismatch';
    END IF;
    PERFORM kl.mutation_on();
    INSERT INTO kl.principal (principal_id, kind, auth_identity, active, last_attested_at) VALUES (p_principal_id, 'admin_user', v_ident, true, now())
    ON CONFLICT (principal_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
      PERFORM kl.audit('kl.principal.created', 'principal', p_principal_id::text, NULL, 'active', NULL, p_principal_id, p_request_id);
    END IF;
    SELECT * INTO pr FROM kl.principal WHERE principal_id = p_principal_id;
  END IF;
  IF pr.kind <> 'admin_user' OR pr.auth_identity <> v_ident THEN
    PERFORM kl.audit('kl.identity_mismatch', 'principal', p_principal_id::text, NULL, NULL, 'identity_mismatch', p_principal_id, p_request_id);
    RETURN 'identity_mismatch';
  END IF;
  IF NOT pr.active THEN
    -- Reactivación: solo una certificación válida lo hace (la conciliación nunca reactiva).
    PERFORM kl.mutation_on();
    UPDATE kl.principal SET active = true, last_attested_at = now(), deactivated_at = NULL, deactivation_source = NULL WHERE principal_id = p_principal_id;
    PERFORM kl.audit('kl.principal.reactivated', 'principal', p_principal_id::text, 'inactive', 'active', NULL, p_principal_id, p_request_id);
  ELSIF pr.last_attested_at IS NULL OR pr.last_attested_at < now() - interval '1 minute' THEN
    PERFORM kl.mutation_on();
    UPDATE kl.principal SET last_attested_at = now()
     WHERE principal_id IN (SELECT principal_id FROM kl.principal WHERE principal_id = p_principal_id FOR UPDATE SKIP LOCKED);
  END IF;
  PERFORM kl.mutation_on();
  INSERT INTO kl.request_attestation (txid, principal_id, session_ref, platform_role, request_id, attested_at)
  VALUES (txid_current(), p_principal_id, p_session_ref, p_platform_role, p_request_id, now());
  PERFORM set_config('kl.actor', p_principal_id::text, true);
  PERFORM set_config('kl.request_id', p_request_id::text, true);
  PERFORM kl.mutation_off();
  RETURN 'ok';
END $$;

-- Cuentas de servicio (kl_agent, kl_knowledge): la identidad sale del rol de BD con que se conectó el worker.
CREATE FUNCTION kl.attest_service(p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_id uuid; pr kl.principal;
BEGIN
  v_id := CASE session_user
    WHEN 'kl_agent' THEN '00000000-0000-4000-8000-0000000000a1'::uuid
    WHEN 'kl_knowledge' THEN '00000000-0000-4000-8000-0000000000a2'::uuid
    ELSE NULL END;
  IF v_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'BV403: este rol de base de datos no certifica cuentas de servicio' USING ERRCODE = 'BV403';
  END IF;
  IF EXISTS (SELECT 1 FROM kl.request_attestation WHERE txid = txid_current()) THEN
    RAISE EXCEPTION 'BV403: una sola certificación por transacción' USING ERRCODE = 'BV403';
  END IF;
  SELECT * INTO pr FROM kl.principal WHERE principal_id = v_id;
  IF NOT FOUND OR NOT pr.active THEN
    RAISE EXCEPTION 'BV403: cuenta de servicio inactiva' USING ERRCODE = 'BV403';
  END IF;
  PERFORM kl.mutation_on();
  -- Sin serializar a los workers: la marca de último uso se actualiza solo si está vencida y sin esperar bloqueos.
  IF pr.last_attested_at IS NULL OR pr.last_attested_at < now() - interval '5 minutes' THEN
    UPDATE kl.principal SET last_attested_at = now()
     WHERE principal_id IN (SELECT principal_id FROM kl.principal WHERE principal_id = v_id FOR UPDATE SKIP LOCKED);
  END IF;
  INSERT INTO kl.request_attestation (txid, principal_id, session_ref, platform_role, request_id, attested_at)
  VALUES (txid_current(), v_id, NULL, 'SERVICE', p_request_id, now());
  PERFORM set_config('kl.actor', v_id::text, true);
  PERFORM set_config('kl.request_id', p_request_id::text, true);
  PERFORM kl.mutation_off();
  RETURN 'ok';
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B3 · Conciliación: defensa adicional que solo DESACTIVA; nunca autoriza ni reactiva.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.reconcile_principal(p_principal_id uuid, p_active_and_login_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE pr kl.principal; v_changed boolean := false;
BEGIN
  SELECT * INTO pr FROM kl.principal WHERE principal_id = p_principal_id AND kind = 'admin_user' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM kl.mutation_on();
  IF pr.active AND NOT coalesce(p_active_and_login_enabled, false) THEN
    UPDATE kl.principal SET active = false, deactivated_at = now(), deactivation_source = 'reconciliation', last_reconciled_at = now() WHERE principal_id = p_principal_id;
    PERFORM kl.audit('kl.principal.deactivated', 'principal', p_principal_id::text, 'active', 'inactive', 'reconciliation', p_principal_id, NULL);
    v_changed := true;
  ELSE
    UPDATE kl.principal SET last_reconciled_at = now() WHERE principal_id = p_principal_id;
  END IF;
  PERFORM kl.mutation_off();
  RETURN v_changed;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Concesión y revocación de roles (solo KL_ADMIN; nadie se concede ni se revoca un rol a sí mismo)
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.grant_role(p_user uuid, p_auth_identity text, p_role text, p_editorial boolean DEFAULT false, p_domains text[] DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; v_ident text := lower(btrim(coalesce(p_auth_identity, ''))); pr kl.principal; v_grant uuid;
BEGIN
  v_actor := kl.begin_mutation('roles.grant');
  IF p_user = v_actor THEN
    RAISE EXCEPTION 'BV403: nadie puede concederse un rol a sí mismo' USING ERRCODE = 'BV403';
  END IF;
  IF p_role IS NULL OR p_role LIKE 'SERVICE\_%' THEN
    RAISE EXCEPTION 'BV403: los roles de servicio se conceden solo por migración' USING ERRCODE = 'BV403';
  END IF;
  IF v_ident = '' OR v_ident LIKE '%@beeside.internal' THEN
    RAISE EXCEPTION 'BV403: identidad no válida para una persona' USING ERRCODE = 'BV403';
  END IF;
  SELECT * INTO pr FROM kl.principal WHERE principal_id = p_user FOR UPDATE;
  IF FOUND THEN
    IF pr.kind <> 'admin_user' OR pr.auth_identity <> v_ident THEN
      RAISE EXCEPTION 'BV403: la identidad no coincide con el principal' USING ERRCODE = 'BV403';
    END IF;
  ELSE
    -- Un titular que aún no entra a KL Admin nace inactivo: su primera certificación válida lo activa.
    INSERT INTO kl.principal (principal_id, kind, auth_identity, active) VALUES (p_user, 'admin_user', v_ident, false);
  END IF;
  INSERT INTO kl.role_grant (admin_user_id, role, editorial, domains, granted_by) VALUES (p_user, p_role, coalesce(p_editorial, false), coalesce(p_domains, '{}'), v_actor) RETURNING grant_id INTO v_grant;
  PERFORM kl.audit('kl.role_grant.grant', 'role_grant', v_grant::text, NULL, p_role, NULL);
  PERFORM kl.mutation_off();
  RETURN v_grant;
END $$;

CREATE FUNCTION kl.revoke_role(p_grant_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; g kl.role_grant;
BEGIN
  v_actor := kl.begin_mutation('roles.revoke');
  SELECT * INTO g FROM kl.role_grant WHERE grant_id = p_grant_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BV404: concesión inexistente o ya revocada' USING ERRCODE = 'BV404';
  END IF;
  IF g.admin_user_id = v_actor THEN
    RAISE EXCEPTION 'BV403: nadie puede revocarse un rol a sí mismo' USING ERRCODE = 'BV403';
  END IF;
  UPDATE kl.role_grant SET revoked_at = now(), revoked_by = v_actor WHERE grant_id = p_grant_id;
  PERFORM kl.audit('kl.role_grant.revoke', 'role_grant', p_grant_id::text, g.role, 'revoked', p_reason);
  PERFORM kl.mutation_off();
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B4 · Arranque auditado de KL_ADMIN (solo kl_owner, una vez; las verificaciones en la base principal las hace
-- el comando kl:bootstrap-admin antes de llamar aquí).
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.bootstrap_admin(p_admin_user_id uuid, p_email text, p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_ident text := lower(btrim(coalesce(p_email, ''))); v_boot constant uuid := '00000000-0000-4000-8000-0000000000a3'; pr kl.principal; v_grant uuid;
BEGIN
  IF session_user <> 'kl_owner' THEN
    RAISE EXCEPTION 'BV403: kl.bootstrap_admin solo puede ejecutarla kl_owner' USING ERRCODE = 'BV403';
  END IF;
  IF p_admin_user_id IS NULL OR p_request_id IS NULL OR v_ident = '' OR v_ident LIKE '%@beeside.internal' THEN
    RAISE EXCEPTION 'BV403: datos de arranque no válidos' USING ERRCODE = 'BV403';
  END IF;
  IF EXISTS (SELECT 1 FROM kl.role_grant WHERE role = 'KL_ADMIN' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'BV403: ya existe un KL_ADMIN no revocado; el arranque se niega' USING ERRCODE = 'BV403';
  END IF;
  PERFORM kl.mutation_on();
  SELECT * INTO pr FROM kl.principal WHERE principal_id = p_admin_user_id FOR UPDATE;
  IF FOUND THEN
    IF pr.kind <> 'admin_user' OR pr.auth_identity <> v_ident THEN
      RAISE EXCEPTION 'BV403: la identidad no coincide con el principal existente' USING ERRCODE = 'BV403';
    END IF;
    UPDATE kl.principal SET active = true, deactivated_at = NULL, deactivation_source = NULL WHERE principal_id = p_admin_user_id;
  ELSE
    INSERT INTO kl.principal (principal_id, kind, auth_identity, active) VALUES (p_admin_user_id, 'admin_user', v_ident, true);
  END IF;
  INSERT INTO kl.role_grant (admin_user_id, role, granted_by) VALUES (p_admin_user_id, 'KL_ADMIN', v_boot) RETURNING grant_id INTO v_grant;
  PERFORM kl.audit('kl.bootstrap_admin', 'role_grant', v_grant::text, NULL, 'KL_ADMIN', NULL, v_boot, p_request_id);
  PERFORM kl.mutation_off();
  RETURN v_grant;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B6 · Cola
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.enqueue_job(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_run_after timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE jk kl.job_kind; v_actor uuid; v_job uuid;
BEGIN
  SELECT * INTO jk FROM kl.job_kind WHERE kind = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BV422: tipo de job desconocido' USING ERRCODE = 'BV422';
  END IF;
  v_actor := kl.begin_mutation(jk.enqueue_permission);
  INSERT INTO kl.job (kind, payload, run_after, max_attempts, requested_by)
  VALUES (p_kind, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_after, now()), jk.max_attempts, v_actor) RETURNING job_id INTO v_job;
  PERFORM kl.audit('kl.job.enqueue', 'job', v_job::text, NULL, 'queued', p_kind);
  PERFORM kl.mutation_off();
  RETURN v_job;
END $$;

-- Toma jobs con arrendamiento: FOR UPDATE SKIP LOCKED. Recupera los arrendamientos vencidos y deja como
-- «dead» los que agotaron sus intentos.
CREATE FUNCTION kl.claim_jobs(p_kinds text[], p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 300) RETURNS SETOF kl.job
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := kl.begin_mutation('job.claim');
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 OR p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'BV422: parámetros de arrendamiento fuera de rango' USING ERRCODE = 'BV422';
  END IF;
  UPDATE kl.job j SET status = 'dead', lease_until = NULL, leased_by = NULL, lease_token = NULL, error_code = coalesce(j.error_code, 'lease_expired'), updated_at = now()
   WHERE j.status = 'leased' AND j.lease_until < now() AND j.attempts >= j.max_attempts;
  RETURN QUERY
  WITH picked AS (
    SELECT j.job_id
      FROM kl.job j JOIN kl.job_kind k ON k.kind = j.kind
     WHERE j.kind = ANY (p_kinds)
       AND k.claim_role IN (SELECT g.role FROM kl.role_grant g WHERE g.admin_user_id = v_actor AND g.revoked_at IS NULL)
       AND ((j.status = 'queued' AND j.run_after <= now()) OR (j.status = 'leased' AND j.lease_until < now() AND j.attempts < j.max_attempts))
     ORDER BY j.run_after, j.created_at
     LIMIT p_limit
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

CREATE FUNCTION kl.complete_job(p_job_id uuid, p_lease_token uuid, p_outcome text, p_error_code text DEFAULT NULL, p_retry_after_seconds integer DEFAULT 60) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE v_actor uuid; j kl.job; v_status text;
BEGIN
  v_actor := kl.begin_mutation('job.claim');
  SELECT * INTO j FROM kl.job WHERE job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status <> 'leased' OR j.leased_by IS DISTINCT FROM v_actor OR j.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'BV409: el job no está arrendado con ese token' USING ERRCODE = 'BV409';
  END IF;
  IF p_outcome = 'succeeded' THEN
    v_status := 'succeeded';
  ELSIF p_outcome = 'failed' THEN
    v_status := CASE WHEN j.attempts >= j.max_attempts THEN 'dead' ELSE 'queued' END;
  ELSE
    RAISE EXCEPTION 'BV422: resultado no válido' USING ERRCODE = 'BV422';
  END IF;
  UPDATE kl.job
     SET status = v_status, lease_until = NULL, leased_by = NULL, lease_token = NULL, updated_at = now(),
         error_code = CASE WHEN p_outcome = 'failed' THEN coalesce(p_error_code, 'failed') ELSE NULL END,
         run_after = CASE WHEN v_status = 'queued' THEN now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 60), 0)) ELSE run_after END
   WHERE job_id = p_job_id;
  PERFORM kl.mutation_off();
  RETURN v_status;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Permisos de ejecución (Contratos de seguridad §8.1). Nada por defecto; ninguna tabla se concede.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION kl.require(text, text), kl.begin_mutation(text, text), kl.can_read(), kl.audit(text, text, text, text, text, text, uuid, uuid),
  kl.mutation_on(), kl.mutation_off(), kl.attach_guards(), kl.job_payload_ok(text, jsonb), kl.bootstrap_admin(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kl.attest(uuid, text, text, text, uuid), kl.reconcile_principal(uuid, boolean), kl.grant_role(uuid, text, text, boolean, text[]),
  kl.revoke_role(uuid, text), kl.enqueue_job(text, jsonb, timestamptz) TO kl_app;
GRANT EXECUTE ON FUNCTION kl.attest_service(uuid), kl.claim_jobs(text[], integer, integer), kl.complete_job(uuid, uuid, text, text, integer) TO kl_agent, kl_knowledge;
GRANT EXECUTE ON FUNCTION kl.enqueue_job(text, jsonb, timestamptz) TO kl_knowledge;

SELECT kl.attach_guards();
