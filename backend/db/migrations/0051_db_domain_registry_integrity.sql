-- DATA-DOMAIN ROLES (one canonical database shared by Discovery and Precision Center) — EXPAND step.
--
-- Until this migration the whole application used ONE runtime group, `beeside_runtime_role` (SELECT/INSERT/UPDATE on every table), and the Discovery runtime
-- login was a member of it, so a Discovery compromise reached 99 of 99 tables (operator accounts, entitlements, Stripe, knowledge, privacy executor).
--   1. `db_domain_registry` declares which domain owns every table and exactly which privileges the Discovery runtime may hold on it.
--   2. `beeside_discovery_rw` (NOLOGIN) is the ONLY group the Discovery runtime login belongs to. It holds nothing but what the registry lists:
--      the 14 Discovery tables (same privileges they carried before) and the shared rate-limit counters (SELECT/INSERT/UPDATE, no DELETE).
--   3. `db_domain_apply_grants()` re-derives the Discovery group's privileges from the registry (idempotent) and REFUSES to run while a table is unregistered:
--      a new table is closed to Discovery until its domain is declared, and a forgotten registration fails the migration instead of leaking.
--   4. `db_domain_close_precision_on_discovery(login)` is the CONTRACT step: the Precision runtime group becomes read-only on the Discovery tables (Precision reads
--      Discovery through the versioned context contract and never writes it). It is NOT run here: it refuses unless the Discovery login has already been moved to
--      the new group, so a Discovery runtime still bound to the old group is never cut off. The deployment `prepare` step performs the move, then this.
-- Nothing here deletes data or changes any table's content. Rollback of the contract step: GRANT INSERT, UPDATE ON the Discovery tables TO beeside_runtime_role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_discovery_rw') THEN
    BEGIN
      CREATE ROLE beeside_discovery_rw NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'the migration user needs CREATEROLE to create beeside_discovery_rw (domain privilege separation)';
    END;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO db_domain_registry (table_name, domain, discovery_privileges) VALUES
  ('admin_audit_event', 'PRECISION', ''),
  ('admin_session', 'PRECISION', ''),
  ('admin_user', 'PRECISION', ''),
  ('analytics_project_profile', 'PRECISION', ''),
  ('answer', 'PRECISION', ''),
  ('assessment_state_transition', 'PRECISION', ''),
  ('billing_alert', 'PRECISION', ''),
  ('billing_inbound_event', 'PRECISION', ''),
  ('capability_rank', 'PRECISION', ''),
  ('capability_taxonomy_category', 'PRECISION', ''),
  ('category_assessment', 'PRECISION', ''),
  ('category_manifest_version', 'PRECISION', ''),
  ('company', 'PRECISION', ''),
  ('company_match_review', 'PRECISION', ''),
  ('company_person', 'PRECISION', ''),
  ('config_version_event', 'PRECISION', ''),
  ('config_version_review', 'PRECISION', ''),
  ('context_pin', 'PRECISION', ''),
  ('country', 'PRECISION', ''),
  ('country_resource', 'PRECISION', ''),
  ('crp_confirmation', 'PRECISION', ''),
  ('db_domain_registry', 'PRECISION', ''),
  ('email_delivery', 'PRECISION', ''),
  ('email_event', 'PRECISION', ''),
  ('entitlement', 'PRECISION', ''),
  ('entitlement_grant', 'PRECISION', ''),
  ('entitlement_program', 'PRECISION', ''),
  ('entitlement_program_eligibility', 'PRECISION', ''),
  ('fa4_access_token', 'DISCOVERY', 'SIU'),
  ('fa4_catalog_change', 'DISCOVERY', 'SI'),
  ('fa4_catalog_entity', 'DISCOVERY', 'SIU'),
  ('fa4_catalog_version', 'DISCOVERY', 'SI'),
  ('fa4_contact_request', 'DISCOVERY', 'SIU'),
  ('fa4_continuation_request', 'DISCOVERY', 'SIU'),
  ('fa4_demand_signal', 'DISCOVERY', 'SIU'),
  ('fa4_email_delivery', 'DISCOVERY', 'SIU'),
  ('fa4_event', 'DISCOVERY', 'SI'),
  ('fa4_legal_acceptance', 'DISCOVERY', 'SI'),
  ('fa4_marketing_consent', 'DISCOVERY', 'SI'),
  ('fa4_privacy_erasure_log', 'DISCOVERY', 'SI'),
  ('fa4_project', 'DISCOVERY', 'SIU'),
  ('fa4_result', 'DISCOVERY', 'SI'),
  ('fa_access_extension', 'PRECISION', ''),
  ('fa_journey_event', 'PRECISION', ''),
  ('fa_project_lifecycle', 'PRECISION', ''),
  ('fact', 'PRECISION', ''),
  ('field_key_registry', 'PRECISION', ''),
  ('finding', 'PRECISION', ''),
  ('integration_delivery', 'PRECISION', ''),
  ('integration_external_ref', 'PRECISION', ''),
  ('internal_assessment', 'PRECISION', ''),
  ('job_run', 'PRECISION', ''),
  ('knowledge_candidate', 'PRECISION', ''),
  ('knowledge_demand', 'PRECISION', ''),
  ('knowledge_demand_event', 'PRECISION', ''),
  ('knowledge_document', 'PRECISION', ''),
  ('knowledge_passage', 'PRECISION', ''),
  ('knowledge_source', 'PRECISION', ''),
  ('legal_acceptance', 'PRECISION', ''),
  ('oh_delivery', 'PRECISION', ''),
  ('operation_hub_link', 'PRECISION', ''),
  ('outbox_event', 'PRECISION', ''),
  ('pack', 'PRECISION', ''),
  ('person', 'PRECISION', ''),
  ('precision_access_token', 'PRECISION', ''),
  ('precision_assessment', 'PRECISION', ''),
  ('precision_config', 'PRECISION', ''),
  ('precision_cover_asset', 'PRECISION', ''),
  ('precision_cover_seen', 'PRECISION', ''),
  ('precision_handoff_package', 'PRECISION', ''),
  ('precision_instance', 'PRECISION', ''),
  ('precision_journey_event', 'PRECISION', ''),
  ('precision_turn', 'PRECISION', ''),
  ('premium_activation_request', 'PRECISION', ''),
  ('premium_checkout', 'PRECISION', ''),
  ('priority_alignment', 'PRECISION', ''),
  ('privacy_erasure_registry', 'PRECISION', ''),
  ('privacy_erasure_run', 'PRECISION', ''),
  ('privacy_policy', 'PRECISION', ''),
  ('project', 'PRECISION', ''),
  ('project_access_token', 'PRECISION', ''),
  ('project_manifest_version', 'PRECISION', ''),
  ('project_origin', 'PRECISION', ''),
  ('project_privacy_event', 'PRECISION', ''),
  ('project_responsibility_change', 'PRECISION', ''),
  ('question_bank_version', 'PRECISION', ''),
  ('rate_limit_counter', 'PLATFORM', 'SIU'),
  ('retention_purge_record', 'PRECISION', ''),
  ('rules_engine_version', 'PRECISION', ''),
  ('rules_matrix_category', 'PRECISION', ''),
  ('service_map_snapshot', 'PRECISION', ''),
  ('snapshot', 'PRECISION', ''),
  ('snapshot_feedback', 'PRECISION', ''),
  ('snapshot_template_version', 'PRECISION', ''),
  ('sponsor', 'PRECISION', ''),
  ('subscription', 'PRECISION', ''),
  ('subscription_event', 'PRECISION', ''),
  ('subscription_state_transition', 'PRECISION', ''),
  ('understanding_frame', 'PRECISION', ''),
  ('understanding_frame_event', 'PRECISION', '');
--> statement-breakpoint

-- the registry is owner-managed: the Precision runtime reads it, nothing at runtime writes it
REVOKE INSERT, UPDATE, DELETE ON db_domain_registry FROM beeside_runtime_role;
--> statement-breakpoint

-- privacy inventory: the new table is classified like every other table (infrastructure metadata, table names only, no personal data)
ALTER TABLE privacy_erasure_registry DISABLE TRIGGER privacy_registry_guard_trigger;
--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason)
  VALUES ('db_domain_registry', 'global', 'global', NULL, NULL, 'infrastructure registry of data-domain ownership; table names and privilege letters only, no personal data');
--> statement-breakpoint
ALTER TABLE privacy_erasure_registry ENABLE TRIGGER privacy_registry_guard_trigger;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION db_domain_apply_grants() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  unmapped text;
  stale text;
  r record;
  seq record;
  privs text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unmapped
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM db_domain_registry d WHERE d.table_name = c.relname);
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'db_domain_registry: tables without a data domain: % (register them before granting anything)', unmapped;
  END IF;
  SELECT string_agg(d.table_name, ', ' ORDER BY d.table_name) INTO stale
    FROM db_domain_registry d WHERE to_regclass(format('public.%I', d.table_name)) IS NULL;
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'db_domain_registry: registered tables that do not exist: %', stale;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM beeside_discovery_rw;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM beeside_discovery_rw;
  GRANT USAGE ON SCHEMA public TO beeside_discovery_rw;
  REVOKE CREATE ON SCHEMA public FROM beeside_discovery_rw;

  FOR r IN SELECT table_name, discovery_privileges FROM db_domain_registry WHERE discovery_privileges <> '' ORDER BY table_name LOOP
    privs := concat_ws(', ',
      CASE WHEN r.discovery_privileges LIKE '%S%' THEN 'SELECT' END,
      CASE WHEN r.discovery_privileges LIKE '%I%' THEN 'INSERT' END,
      CASE WHEN r.discovery_privileges LIKE '%U%' THEN 'UPDATE' END,
      CASE WHEN r.discovery_privileges LIKE '%D%' THEN 'DELETE' END);
    EXECUTE format('GRANT %s ON public.%I TO beeside_discovery_rw', privs, r.table_name);
    IF r.discovery_privileges LIKE '%I%' THEN
      FOR seq IN
        SELECT s.relname FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
          JOIN pg_class t ON t.oid = d.refobjid
         WHERE s.relkind = 'S' AND t.relname = r.table_name AND t.relnamespace = 'public'::regnamespace
      LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO beeside_discovery_rw', seq.relname);
      END LOOP;
    END IF;
  END LOOP;

  -- readiness reads the migration registry; it may never write it
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA drizzle TO beeside_discovery_rw;
    GRANT SELECT ON drizzle.__drizzle_migrations TO beeside_discovery_rw;
  END IF;
END
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION db_domain_close_precision_on_discovery(p_discovery_login text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_discovery_login) THEN
    RAISE EXCEPTION 'discovery login % does not exist', p_discovery_login;
  END IF;
  IF NOT pg_has_role(p_discovery_login, 'beeside_discovery_rw', 'MEMBER') THEN
    RAISE EXCEPTION 'discovery login % is not a member of beeside_discovery_rw: move it first', p_discovery_login;
  END IF;
  IF pg_has_role(p_discovery_login, 'beeside_runtime_role', 'MEMBER') THEN
    RAISE EXCEPTION 'discovery login % is still a member of beeside_runtime_role: revoke that membership first (the Precision group is about to lose write access to Discovery tables)', p_discovery_login;
  END IF;
  FOR r IN SELECT table_name FROM db_domain_registry WHERE domain = 'DISCOVERY' ORDER BY table_name LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM beeside_runtime_role', r.table_name);
  END LOOP;
END
$fn$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION db_domain_apply_grants() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION db_domain_close_precision_on_discovery(text) FROM PUBLIC;
--> statement-breakpoint
SELECT db_domain_apply_grants();
