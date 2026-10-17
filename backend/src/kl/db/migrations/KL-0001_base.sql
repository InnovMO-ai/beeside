-- KL-0001 · Base de KL: controles de acceso (CR-KL-002 §8.2), identidad (B1), autorización transaccional (B2),
-- certificación (B3), auditoría (B5), cola (B6). Se aplica solo a beeside_kl, como kl_owner, con el runner de KL.
-- Los roles los aprovisiona Plataforma (Terraform, G2) o db/bootstrap/roles.sql en local y CI: aquí solo se verifican.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['kl_owner','kl_app','kl_reader_precision','kl_agent','kl_knowledge'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE EXCEPTION 'KL-0001: el rol % no existe (lo aprovisiona Plataforma)', r;
    END IF;
  END LOOP;
  IF current_user <> 'kl_owner' THEN
    RAISE EXCEPTION 'KL-0001: debe ejecutarse como kl_owner, no como %', current_user;
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'kl_owner' THEN
    RAISE EXCEPTION 'KL-0001: la base % debe pertenecer a kl_owner', current_database();
  END IF;
END $$;

-- §8.2 · CONNECT solo para los cinco roles; nada para PUBLIC; nada en public.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO kl_owner, kl_app, kl_reader_precision, kl_agent, kl_knowledge', current_database());
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA kl FROM PUBLIC;
GRANT USAGE ON SCHEMA kl TO kl_app, kl_reader_precision, kl_agent, kl_knowledge;
ALTER DEFAULT PRIVILEGES FOR ROLE kl_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE kl_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE kl_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE kl_owner REVOKE ALL ON TYPES FROM PUBLIC;

-- Ningún objeto de KL se crea en public (la sesión de migración trabaja solo en kl).
-- ---------------------------------------------------------------------------------------------------------------
-- Guardas genéricas. El indicador de transacción kl.mutation_authorized solo lo enciende una función kl.* tras
-- kl.require (mismo patrón que config_set_write_authorized); aplica también al dueño. Los triggers de
-- inmutabilidad de principal son incondicionales.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION kl.guard_dml() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('kl.mutation_authorized', true), '') <> 'on' THEN
    RAISE EXCEPTION 'kl.%: % directo rechazado (sin mutación autorizada en esta transacción)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV403';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION kl.guard_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kl.% no admite DELETE (KL conserva su historia)', TG_TABLE_NAME USING ERRCODE = 'BV601';
END $$;

CREATE FUNCTION kl.guard_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kl.% es de solo inserción: % rechazado', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BV601';
END $$;

CREATE FUNCTION kl.guard_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'kl.% no admite TRUNCATE', TG_TABLE_NAME USING ERRCODE = 'BV601';
END $$;

-- Conecta las guardas estándar a todas las tablas de kl que aún no las tengan (se invoca al final de cada
-- migración que crea tablas; la prueba de integridad verifica que ninguna tabla quede sin guardas).
CREATE FUNCTION kl.attach_guards() RETURNS integer
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE t record; n integer := 0;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'kl' AND c.relkind = 'r' AND c.relname <> '__kl_migrations' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('kl.%I', t.relname)::regclass AND tgname = 'kl_a_guard_dml') THEN
      EXECUTE format('CREATE TRIGGER kl_a_guard_dml BEFORE INSERT OR UPDATE OR DELETE ON kl.%I FOR EACH ROW EXECUTE FUNCTION kl.guard_dml()', t.relname);
      EXECUTE format('CREATE TRIGGER kl_a_no_truncate BEFORE TRUNCATE ON kl.%I FOR EACH STATEMENT EXECUTE FUNCTION kl.guard_no_truncate()', t.relname);
      EXECUTE format('CREATE TRIGGER kl_c_no_delete BEFORE DELETE ON kl.%I FOR EACH ROW EXECUTE FUNCTION kl.guard_no_delete()', t.relname);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Ayudantes de mutación autorizada (privados: solo los invocan funciones SECURITY DEFINER de kl).
CREATE FUNCTION kl.mutation_on() RETURNS void
LANGUAGE sql SET search_path = kl, pg_temp AS $$ SELECT set_config('kl.mutation_authorized', 'on', true); $$;
CREATE FUNCTION kl.mutation_off() RETURNS void
LANGUAGE sql SET search_path = kl, pg_temp AS $$ SELECT set_config('kl.mutation_authorized', 'off', true); $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B1 · Identidad
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.principal (
  principal_id        uuid PRIMARY KEY,
  kind                text NOT NULL CHECK (kind IN ('admin_user', 'service')),
  auth_identity       text NOT NULL UNIQUE,
  active              boolean NOT NULL,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_attested_at    timestamptz,
  last_reconciled_at  timestamptz,
  deactivated_at      timestamptz,
  deactivation_source text CHECK (deactivation_source IN ('reconciliation', 'attestation')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT principal_identity_shape CHECK (
    auth_identity = lower(auth_identity)
    AND ((kind = 'service') = (auth_identity LIKE '%@beeside.internal'))
  )
);

-- Siembra de las cuentas de servicio con UUID fijo (Contratos de seguridad §2).
SELECT kl.mutation_on();
INSERT INTO kl.principal (principal_id, kind, auth_identity, active) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'service', 'kl-agent@beeside.internal', true),
  ('00000000-0000-4000-8000-0000000000a2', 'service', 'kl-knowledge@beeside.internal', true),
  ('00000000-0000-4000-8000-0000000000a3', 'service', 'kl-bootstrap@beeside.internal', true);
SELECT kl.mutation_off();

CREATE FUNCTION kl.guard_principal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kl.principal no admite DELETE (la identidad nunca se borra)' USING ERRCODE = 'BV601';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.principal_id IS DISTINCT FROM OLD.principal_id OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.auth_identity IS DISTINCT FROM OLD.auth_identity OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'kl.principal: principal_id, kind, auth_identity y first_seen_at son inmutables' USING ERRCODE = 'BV601';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_principal_immutable BEFORE UPDATE OR DELETE ON kl.principal FOR EACH ROW EXECUTE FUNCTION kl.guard_principal();

-- ---------------------------------------------------------------------------------------------------------------
-- B3 · Certificación por petición (solo inserción; una por transacción)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.request_attestation (
  attestation_id bigserial PRIMARY KEY,
  txid           bigint NOT NULL UNIQUE,
  principal_id   uuid NOT NULL REFERENCES kl.principal (principal_id),
  session_ref    text CHECK (session_ref ~ '^[0-9a-f]{64}$'),
  platform_role  text NOT NULL CHECK (platform_role IN ('ADMIN', 'SUPERVISOR', 'SERVICE')),
  request_id     uuid NOT NULL,
  attested_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attestation_session_shape CHECK ((platform_role = 'SERVICE') = (session_ref IS NULL))
);
CREATE INDEX request_attestation_principal_idx ON kl.request_attestation (principal_id, attested_at);
CREATE INDEX request_attestation_request_idx ON kl.request_attestation (request_id);

-- ---------------------------------------------------------------------------------------------------------------
-- B2 · Permisos por rol (matriz de Design Spec §7, sembrada por migración; solo cambia con otra migración)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.permission_role (
  permission      text NOT NULL,
  role            text NOT NULL CHECK (role IN ('KL_ADMIN', 'KL_REVIEWER', 'KL_REVIEWER_EDITORIAL', 'KL_EDITOR', 'SPECIALIST_VALIDATOR', 'SUPERVISOR', 'SERVICE_AGENT', 'SERVICE_KNOWLEDGE')),
  requires_domain boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (permission, role),
  CONSTRAINT supervisor_read_only CHECK (role <> 'SUPERVISOR' OR permission = 'kl.read')
);

SELECT kl.mutation_on();
INSERT INTO kl.permission_role (permission, role, requires_domain) VALUES
  -- Leer KL Admin
  ('kl.read', 'KL_ADMIN', false), ('kl.read', 'KL_REVIEWER', false), ('kl.read', 'KL_REVIEWER_EDITORIAL', false),
  ('kl.read', 'KL_EDITOR', false), ('kl.read', 'SUPERVISOR', false),
  ('kl.read_own_queue', 'SPECIALIST_VALIDATOR', true),
  -- Proponer fuente
  ('source.propose', 'KL_ADMIN', false), ('source.propose', 'KL_REVIEWER', false), ('source.propose', 'KL_REVIEWER_EDITORIAL', false), ('source.propose', 'KL_EDITOR', false),
  -- Aprobar, suspender, revocar fuente; excepciones
  ('source.decide', 'KL_ADMIN', false),
  -- Subir carga / redactar ficha
  ('content.author', 'KL_EDITOR', false),
  -- Aprobar carga o ficha nivel 2
  ('content.approve_l2', 'KL_REVIEWER', false), ('content.approve_l2', 'KL_REVIEWER_EDITORIAL', false),
  -- Validar nivel 3 (su dominio) / registrar validación externa
  ('validation.validate', 'SPECIALIST_VALIDATOR', true),
  ('validation.record_external', 'KL_REVIEWER', false), ('validation.record_external', 'KL_REVIEWER_EDITORIAL', false),
  -- Decidir demanda (KL_ADMIN también cuando hay fuente o costo)
  ('demand.decide', 'KL_ADMIN', false), ('demand.decide', 'KL_REVIEWER', false), ('demand.decide', 'KL_REVIEWER_EDITORIAL', false),
  ('demand.decide_admin', 'KL_ADMIN', false),
  -- Aprobar cambio de producto y edición; despublicar
  ('product.approve_change', 'KL_REVIEWER_EDITORIAL', false), ('edition.approve', 'KL_REVIEWER_EDITORIAL', false), ('edition.unpublish', 'KL_REVIEWER_EDITORIAL', false),
  -- Revocar edición
  ('edition.revoke', 'KL_ADMIN', false),
  -- Proponer conocimiento de respaldo para equivalencias de la RAM
  ('ram.propose_equivalence', 'KL_EDITOR', false),
  -- Políticas, presupuestos, promoción automática de RAM, roles KL
  ('settings.write', 'KL_ADMIN', false), ('ram.auto_promotion', 'KL_ADMIN', false), ('roles.grant', 'KL_ADMIN', false), ('roles.revoke', 'KL_ADMIN', false),
  -- Cola de trabajos (B6): «Revisar ahora» (KL_EDITOR o KL_ADMIN), «Edición extraordinaria» (KL_ADMIN), planificador y workers
  ('job.enqueue', 'KL_EDITOR', false), ('job.enqueue', 'KL_ADMIN', false),
  ('job.enqueue_extraordinary', 'KL_ADMIN', false),
  ('job.enqueue_system', 'SERVICE_KNOWLEDGE', false),
  ('job.claim', 'SERVICE_AGENT', false), ('job.claim', 'SERVICE_KNOWLEDGE', false),
  ('agent.collect', 'SERVICE_AGENT', false),
  ('agent.compile', 'SERVICE_KNOWLEDGE', false);
SELECT kl.mutation_off();

-- ---------------------------------------------------------------------------------------------------------------
-- Concesiones de rol (sobre kl.principal). Inmutables salvo la revocación.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.role_grant (
  grant_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES kl.principal (principal_id),
  role          text NOT NULL CHECK (role IN ('KL_ADMIN', 'KL_EDITOR', 'KL_REVIEWER', 'SPECIALIST_VALIDATOR', 'SERVICE_AGENT', 'SERVICE_KNOWLEDGE')),
  editorial     boolean NOT NULL DEFAULT false,
  domains       text[] NOT NULL DEFAULT '{}',
  granted_by    uuid NOT NULL REFERENCES kl.principal (principal_id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES kl.principal (principal_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_not_self CHECK (granted_by <> admin_user_id),
  CONSTRAINT grant_revoke_not_self CHECK (revoked_by IS NULL OR revoked_by <> admin_user_id),
  CONSTRAINT grant_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT grant_editorial_only_reviewer CHECK (NOT editorial OR role = 'KL_REVIEWER'),
  CONSTRAINT grant_domains_only_validator CHECK ((role = 'SPECIALIST_VALIDATOR') = (cardinality(domains) > 0))
);
CREATE UNIQUE INDEX role_grant_active_unique ON kl.role_grant (admin_user_id, role) WHERE revoked_at IS NULL;
CREATE INDEX role_grant_user_idx ON kl.role_grant (admin_user_id) WHERE revoked_at IS NULL;

CREATE FUNCTION kl.guard_role_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = kl, pg_temp AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kl.role_grant no admite DELETE' USING ERRCODE = 'BV601';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT kind INTO k FROM kl.principal WHERE principal_id = NEW.admin_user_id;
    IF NEW.role LIKE 'SERVICE_%' AND k <> 'service' THEN
      RAISE EXCEPTION 'un rol de servicio solo se concede a una cuenta de servicio' USING ERRCODE = 'BV403';
    ELSIF NEW.role NOT LIKE 'SERVICE_%' AND k <> 'admin_user' THEN
      RAISE EXCEPTION 'un rol humano solo se concede a un admin_user' USING ERRCODE = 'BV403';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: solo la revocación, una vez.
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (NEW.grant_id, NEW.admin_user_id, NEW.role, NEW.editorial, NEW.domains, NEW.granted_by, NEW.granted_at, NEW.created_at)
        IS DISTINCT FROM (OLD.grant_id, OLD.admin_user_id, OLD.role, OLD.editorial, OLD.domains, OLD.granted_by, OLD.granted_at, OLD.created_at) THEN
    RAISE EXCEPTION 'kl.role_grant: solo se permite registrar la revocación, una vez' USING ERRCODE = 'BV601';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kl_b_role_grant_rules BEFORE INSERT OR UPDATE OR DELETE ON kl.role_grant FOR EACH ROW EXECUTE FUNCTION kl.guard_role_grant();

-- Concesión de los roles de servicio (la cuenta kl-bootstrap las otorga).
SELECT kl.mutation_on();
INSERT INTO kl.role_grant (admin_user_id, role, granted_by) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'SERVICE_AGENT', '00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000a2', 'SERVICE_KNOWLEDGE', '00000000-0000-4000-8000-0000000000a3');
SELECT kl.mutation_off();

-- ---------------------------------------------------------------------------------------------------------------
-- B5 · Auditoría (solo inserción; se escribe en la misma transacción que el cambio)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.audit_event (
  event_id           bigserial PRIMARY KEY,
  at                 timestamptz NOT NULL DEFAULT now(),
  actor_principal_id uuid NOT NULL REFERENCES kl.principal (principal_id),
  request_id         uuid,
  session_ref        text,
  action             text NOT NULL CHECK (action ~ '^kl\.[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  entity             text,
  entity_id          text,
  from_status        text,
  to_status          text,
  reason             text CHECK (reason IS NULL OR length(reason) <= 500),
  diff_ref           text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_request_idx ON kl.audit_event (request_id);
CREATE INDEX audit_event_actor_idx ON kl.audit_event (actor_principal_id, at);
CREATE INDEX audit_event_entity_idx ON kl.audit_event (entity, entity_id);

-- Escritura de auditoría. El actor y la petición salen de la certificación de ESTA transacción (nunca de un
-- valor de sesión que el llamador pueda fijar), salvo que una función interna indique el actor (arranque,
-- conciliación, rechazos de identidad).
CREATE FUNCTION kl.audit(p_action text, p_entity text, p_entity_id text, p_from text, p_to text, p_reason text, p_actor uuid DEFAULT NULL, p_request uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = kl, pg_temp AS $$
DECLARE a kl.request_attestation; v_actor uuid; v_req uuid; v_session text; v_prev text;
BEGIN
  SELECT * INTO a FROM kl.request_attestation WHERE txid = txid_current();
  v_actor := coalesce(p_actor, a.principal_id);
  v_req := coalesce(p_request, a.request_id);
  v_session := a.session_ref;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'kl.audit: sin actor certificado' USING ERRCODE = 'BV403';
  END IF;
  v_prev := coalesce(current_setting('kl.mutation_authorized', true), 'off');
  PERFORM set_config('kl.mutation_authorized', 'on', true);
  INSERT INTO kl.audit_event (actor_principal_id, request_id, session_ref, action, entity, entity_id, from_status, to_status, reason)
  VALUES (v_actor, v_req, v_session, p_action, p_entity, p_entity_id, p_from, p_to, left(p_reason, 500));
  PERFORM set_config('kl.mutation_authorized', v_prev, true);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B6 · Cola de trabajos propia (kl.job, FOR UPDATE SKIP LOCKED). El payload es de lista blanca por tipo.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.job_kind (
  kind               text PRIMARY KEY CHECK (kind ~ '^[a-z_]{1,40}$'),
  allowed_keys       text[] NOT NULL,
  enqueue_permission text NOT NULL,
  claim_role         text NOT NULL CHECK (claim_role IN ('SERVICE_AGENT', 'SERVICE_KNOWLEDGE')),
  max_attempts       integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  created_at         timestamptz NOT NULL DEFAULT now()
);

SELECT kl.mutation_on();
INSERT INTO kl.job_kind (kind, allowed_keys, enqueue_permission, claim_role) VALUES
  ('review_now',            ARRAY['publication_key'],             'job.enqueue',              'SERVICE_AGENT'),
  ('collect',               ARRAY['publication_key'],             'job.enqueue_system',       'SERVICE_AGENT'),
  ('extraordinary_edition', ARRAY['product_key', 'reason_code'],  'job.enqueue_extraordinary', 'SERVICE_KNOWLEDGE'),
  ('compile_package',       ARRAY['package_key'],                 'job.enqueue_system',       'SERVICE_KNOWLEDGE'),
  ('render_edition',        ARRAY['edition_id'],                  'job.enqueue_system',       'SERVICE_KNOWLEDGE'),
  ('schedule_tick',         ARRAY[]::text[],                      'job.enqueue_system',       'SERVICE_KNOWLEDGE'),
  ('noop',                  ARRAY['ref'],                         'job.enqueue_system',       'SERVICE_KNOWLEDGE');
SELECT kl.mutation_off();

CREATE TABLE kl.job (
  job_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL REFERENCES kl.job_kind (kind),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'succeeded', 'failed', 'dead')),
  run_after    timestamptz NOT NULL DEFAULT now(),
  lease_until  timestamptz,
  leased_by    uuid REFERENCES kl.principal (principal_id),
  lease_token  uuid,
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  requested_by uuid NOT NULL REFERENCES kl.principal (principal_id),
  agent_run_id uuid,
  error_code   text CHECK (error_code ~ '^[a-z0-9_]{1,60}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_lease_pair CHECK ((status = 'leased') = (lease_until IS NOT NULL AND leased_by IS NOT NULL AND lease_token IS NOT NULL))
);
CREATE INDEX job_claim_idx ON kl.job (status, run_after);
CREATE INDEX job_kind_idx ON kl.job (kind, status);
