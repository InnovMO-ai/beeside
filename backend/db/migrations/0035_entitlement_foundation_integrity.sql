-- Premium entitlement foundation, part 2: derivation + integrity. Hand-written (drizzle cannot express triggers/functions).
--   1. premium_access_source: raw, uniform list of every access row (paid subscriptions + grants) for inspection/Admin.
--   2. entitlement_sources_for(project): the sources that APPLY to one project (company grants only through their explicit
--      scope; non-paid sources only once the First Assessment is locked).
--   3. entitlement_recompute(project, now): the single derivation of the `entitlement` projection (what Precision reads).
--      Same state machine and constraints as 0022 (FULL -> READ_ONLY -> REVOKED, or back to FULL).
--      Paid sources follow their lifecycle status (never the clock, as before); grants are clock-bound.
--   4. entitlement_covered_until(project, now): where current access runs out. The ONE stacking rule: a paid term starts
--      when the access the client already holds ends (no overlap, nothing lost, nothing uncontrolled).
--   5. Triggers: subscription -> recompute (history kept); grant -> recompute; project locked -> recompute.
--   6. Guards: ledgers are append-only; a grant's terms are immutable (only a write-once termination); governance (company-level
--      and program-based grants, programs and sponsors need a SUPER_ADMIN); programs/eligibility rules; privacy ledger and state.
-- NOTE: the new admin_role value (0027) is only used at run time inside plpgsql bodies, never as a literal in this file.
--
-- Revert (manual; one transaction, newest first). Data in the new tables is lost on DROP:
--   BEGIN;
--   DROP TRIGGER IF EXISTS project_locked_entitlement_trigger ON project;
--   DROP TRIGGER IF EXISTS entitlement_grant_sync_trigger ON entitlement_grant;
--   DROP TRIGGER IF EXISTS entitlement_grant_insert_guard_trigger ON entitlement_grant;
--   DROP TRIGGER IF EXISTS entitlement_grant_guard_trigger ON entitlement_grant;
--   DROP TRIGGER IF EXISTS entitlement_grant_no_truncate ON entitlement_grant;
--   DROP TRIGGER IF EXISTS entitlement_program_guard_trigger ON entitlement_program;
--   DROP TRIGGER IF EXISTS entitlement_program_no_truncate ON entitlement_program;
--   DROP TRIGGER IF EXISTS entitlement_eligibility_guard_trigger ON entitlement_program_eligibility;
--   DROP TRIGGER IF EXISTS sponsor_guard_trigger ON sponsor;
--   DROP TRIGGER IF EXISTS project_privacy_event_guard_trigger ON project_privacy_event;
--   DROP FUNCTION IF EXISTS project_locked_entitlement(), entitlement_grant_sync(), entitlement_grant_insert_guard(), entitlement_grant_guard(),
--     entitlement_program_guard(), entitlement_eligibility_guard(), sponsor_guard(), project_privacy_event_guard(), entitlement_ledger_truncate_guard();
--   -- restore the 0022 body of subscription_sync_entitlement_and_history() (CREATE OR REPLACE from 0022), then:
--   DROP FUNCTION IF EXISTS entitlement_covered_until(UUID, TIMESTAMPTZ), entitlement_recompute(UUID, TIMESTAMPTZ),
--     entitlement_sources_for(UUID), entitlement_company_grant_covers(UUID, UUID), entitlement_is_elevated(UUID);
--   DROP VIEW IF EXISTS project_privacy_state, premium_access_source;
--   DROP TABLE project_privacy_event, entitlement_grant, entitlement_program_eligibility, entitlement_program, sponsor;
--   COMMIT;  -- the admin_role value SUPER_ADMIN cannot be dropped from an enum; leaving it is harmless.

-- =========================================================================
-- 1. Uniform list of access rows (inspection / Admin)
-- =========================================================================
CREATE VIEW premium_access_source AS
  SELECT s.subscription_id::text AS source_ref,
         'paid'::text AS source,
         s.project_id,
         NULL::uuid AS company_id,
         NULL::uuid AS grant_id,
         NULL::uuid AS program_id,
         s.current_period_start AS starts_at,
         s.current_period_end AS ends_at,
         CASE WHEN s.status = 'PREMIUM_INACTIVE' THEN COALESCE(s.ended_at, s.current_period_end) ELSE s.current_period_end END AS effective_end,
         (s.status = 'PREMIUM_INACTIVE') AS closed,
         (s.status = 'PREMIUM_ACTIVE') AS open_ended,
         false AS clock_bound
    FROM subscription s
  UNION ALL
  SELECT g.grant_id::text,
         g.source,
         g.project_id,
         g.company_id,
         g.grant_id,
         g.program_id,
         g.starts_at,
         g.ends_at,
         LEAST(g.ends_at, COALESCE(g.terminated_at, g.ends_at)),
         (g.terminated_at IS NOT NULL),
         false,
         true
    FROM entitlement_grant g;--> statement-breakpoint

-- =========================================================================
-- 2. Governance helper and company-grant coverage
-- =========================================================================
CREATE FUNCTION entitlement_is_elevated(p_admin UUID) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = p_admin AND active AND role::text = 'SUPER_ADMIN');
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint

-- Does a COMPANY grant cover this project? Only through its explicit scope, then its optional cap (earliest created first).
CREATE FUNCTION entitlement_company_grant_covers(p_grant UUID, p_project UUID) RETURNS BOOLEAN AS $$
DECLARE
  g entitlement_grant%ROWTYPE;
  p project%ROWTYPE;
  v_rank BIGINT;
BEGIN
  SELECT * INTO g FROM entitlement_grant WHERE grant_id = p_grant;
  SELECT * INTO p FROM project WHERE project_id = p_project;
  IF g.grant_id IS NULL OR p.project_id IS NULL OR g.company_id IS NULL OR p.company_id <> g.company_id THEN
    RETURN false;
  END IF;
  IF g.company_scope = 'current_projects' THEN
    IF p.created_at > g.created_at THEN RETURN false; END IF;
  ELSE
    IF p.created_at < g.starts_at OR p.created_at >= g.ends_at THEN RETURN false; END IF;
  END IF;
  IF g.max_projects IS NOT NULL THEN
    SELECT count(*) INTO v_rank FROM project q
     WHERE q.company_id = g.company_id
       AND CASE WHEN g.company_scope = 'current_projects' THEN q.created_at <= g.created_at
                ELSE q.created_at >= g.starts_at AND q.created_at < g.ends_at END
       AND (q.created_at, q.project_id) <= (p.created_at, p.project_id);
    IF v_rank > g.max_projects THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint

-- =========================================================================
-- 3. The sources that apply to ONE project
-- =========================================================================
CREATE FUNCTION entitlement_sources_for(p_project UUID)
RETURNS TABLE (source TEXT, source_ref TEXT, starts_at TIMESTAMPTZ, effective_end TIMESTAMPTZ, closed BOOLEAN, open_ended BOOLEAN, clock_bound BOOLEAN) AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  SELECT (assessment_state = 'COMPLETED_LOCKED') INTO v_locked FROM project WHERE project_id = p_project;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.source, a.source_ref, a.starts_at, a.effective_end, a.closed, a.open_ended, a.clock_bound
      FROM premium_access_source a
     WHERE (a.project_id = p_project AND a.source = 'paid')
        -- Non-paid sources only count for a project whose First Assessment is completed and locked.
        OR (v_locked AND a.source <> 'paid' AND (
              a.project_id = p_project
              OR (a.company_id IS NOT NULL AND entitlement_company_grant_covers(a.grant_id, p_project))));
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint

-- =========================================================================
-- 4. The single derivation of the entitlement projection
-- =========================================================================
CREATE FUNCTION entitlement_recompute(p_project UUID, p_now TIMESTAMPTZ DEFAULT now()) RETURNS void AS $$
DECLARE
  v_cur entitlement%ROWTYPE;
  v_found BOOLEAN;
  v_active BOOLEAN;
  v_open BOOLEAN;
  v_from TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
  v_last_end TIMESTAMPTZ;
  v_first_start TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project WHERE project_id = p_project) THEN
    RETURN;
  END IF;

  SELECT COALESCE(bool_or(is_active), false),
         COALESCE(bool_or(is_active AND open_ended), false),
         min(starts_at) FILTER (WHERE is_active),
         max(effective_end) FILTER (WHERE is_active),
         max(effective_end) FILTER (WHERE is_ended),
         min(starts_at) FILTER (WHERE is_active OR is_ended)
    INTO v_active, v_open, v_from, v_until, v_last_end, v_first_start
    FROM (
      SELECT starts_at, effective_end, open_ended,
             CASE WHEN clock_bound THEN (starts_at <= p_now AND effective_end > p_now) ELSE NOT closed END AS is_active,
             CASE WHEN clock_bound THEN (starts_at <= p_now AND effective_end <= p_now) ELSE closed END AS is_ended
        FROM entitlement_sources_for(p_project)
    ) s;

  SELECT * INTO v_cur FROM entitlement WHERE project_id = p_project FOR UPDATE;
  v_found := FOUND;

  IF v_active THEN
    IF NOT v_found THEN
      INSERT INTO entitlement (project_id, premium_access_active, effective_from, effective_until, updated_at, precision_access_mode)
        VALUES (p_project, true, v_from, CASE WHEN v_open THEN NULL ELSE v_until END, now(), 'FULL');
    ELSE
      -- Active (now or newly) => FULL with every end-of-Premium field cleared (automatic return to FULL on a new source).
      UPDATE entitlement SET
        premium_access_active = true,
        effective_from = CASE WHEN v_cur.premium_access_active THEN v_cur.effective_from ELSE v_from END,
        effective_until = CASE WHEN v_open THEN NULL ELSE v_until END,
        updated_at = now(),
        precision_access_mode = 'FULL',
        premium_ended_at = NULL, readonly_until = NULL, grace_days_applied = NULL, revoked_at = NULL
       WHERE project_id = p_project;
    END IF;
  ELSIF v_last_end IS NOT NULL THEN
    IF NOT v_found THEN
      INSERT INTO entitlement (project_id, premium_access_active, effective_from, effective_until, updated_at, precision_access_mode, premium_ended_at)
        VALUES (p_project, false, v_first_start, v_last_end, now(), 'READ_ONLY', v_last_end);
    ELSIF v_cur.premium_access_active THEN
      -- active -> ended => READ_ONLY from the end of Premium; the Core sweep settles readonly_until from configuration.
      UPDATE entitlement SET
        premium_access_active = false,
        effective_until = v_last_end,
        updated_at = now(),
        precision_access_mode = 'READ_ONLY',
        premium_ended_at = v_last_end, readonly_until = NULL, grace_days_applied = NULL, revoked_at = NULL
       WHERE project_id = p_project;
    END IF;
    -- ended -> ended keeps the state the sweep reached (never moves backwards: READ_ONLY/REVOKED stay as they are).
  END IF;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- =========================================================================
-- 5. THE STACKING RULE: where does the access the project holds RUN OUT?
--    Contiguous coverage by dates across all applicable sources (a source that starts exactly when another ends continues it).
--    A paid term is placed at/after this instant: the client keeps every free day and is never charged for a day already covered.
-- =========================================================================
CREATE FUNCTION entitlement_covered_until(p_project UUID, p_now TIMESTAMPTZ DEFAULT now()) RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_t TIMESTAMPTZ := p_now;
  v_next TIMESTAMPTZ;
  v_guard INT := 0;
BEGIN
  LOOP
    SELECT max(s.effective_end) INTO v_next
      FROM entitlement_sources_for(p_project) s
     WHERE NOT s.closed AND s.starts_at <= v_t AND s.effective_end > v_t;
    EXIT WHEN v_next IS NULL OR v_next <= v_t;
    v_t := v_next;
    v_guard := v_guard + 1;
    EXIT WHEN v_guard >= 100;
  END LOOP;
  RETURN v_t;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint

-- =========================================================================
-- 6. Triggers: every source goes through the same derivation
-- =========================================================================
CREATE OR REPLACE FUNCTION subscription_sync_entitlement_and_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO subscription_state_transition (project_id, subscription_id, from_state, to_state, trigger)
    VALUES (
      NEW.project_id,
      NEW.subscription_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      NEW.status,
      'subscription_write'
    );
  END IF;
  PERFORM entitlement_recompute(NEW.project_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION entitlement_grant_sync() RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    PERFORM entitlement_recompute(NEW.project_id);
  ELSE
    FOR r IN SELECT project_id FROM project WHERE company_id = NEW.company_id AND assessment_state = 'COMPLETED_LOCKED' LOOP
      PERFORM entitlement_recompute(r.project_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_grant_sync_trigger AFTER INSERT OR UPDATE ON entitlement_grant
  FOR EACH ROW EXECUTE FUNCTION entitlement_grant_sync();--> statement-breakpoint

-- A project that locks its First Assessment inside a company-level agreement starts with the access that agreement gives it.
CREATE FUNCTION project_locked_entitlement() RETURNS TRIGGER AS $$
BEGIN
  PERFORM entitlement_recompute(NEW.project_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER project_locked_entitlement_trigger AFTER UPDATE OF assessment_state ON project
  FOR EACH ROW WHEN (NEW.assessment_state = 'COMPLETED_LOCKED' AND OLD.assessment_state IS DISTINCT FROM 'COMPLETED_LOCKED')
  EXECUTE FUNCTION project_locked_entitlement();--> statement-breakpoint

-- =========================================================================
-- 7. Ledgers are never truncated; grants: immutable terms, write-once termination, governed insert
-- =========================================================================
CREATE FUNCTION entitlement_ledger_truncate_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is an append-only ledger and cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION entitlement_grant_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entitlement_grant rows are never deleted (%)', OLD.grant_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.company_scope IS DISTINCT FROM OLD.company_scope OR NEW.max_projects IS DISTINCT FROM OLD.max_projects
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.market_scope IS DISTINCT FROM OLD.market_scope OR NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.created_by_actor IS DISTINCT FROM OLD.created_by_actor OR NEW.extends_grant_id IS DISTINCT FROM OLD.extends_grant_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'entitlement_grant % terms are immutable; extend with a new grant or terminate', OLD.grant_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.terminated_at IS NOT NULL AND (NEW.terminated_at IS DISTINCT FROM OLD.terminated_at OR NEW.terminated_by IS DISTINCT FROM OLD.terminated_by
     OR NEW.termination_reason IS DISTINCT FROM OLD.termination_reason) THEN
    RAISE EXCEPTION 'entitlement_grant % termination is write-once', OLD.grant_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.terminated_at IS NOT NULL AND NEW.terminated_at > OLD.ends_at THEN
    RAISE EXCEPTION 'entitlement_grant % cannot be terminated after it ended', OLD.grant_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.terminated_at IS NOT NULL AND OLD.terminated_at IS NULL AND NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = NEW.terminated_by AND active) THEN
    RAISE EXCEPTION 'a grant is terminated by an active admin' USING ERRCODE = 'BV409';
  END IF;
  NEW.modified_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_grant_guard_trigger BEFORE UPDATE OR DELETE ON entitlement_grant
  FOR EACH ROW EXECUTE FUNCTION entitlement_grant_guard();--> statement-breakpoint
CREATE TRIGGER entitlement_grant_no_truncate BEFORE TRUNCATE ON entitlement_grant
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();--> statement-breakpoint

CREATE FUNCTION entitlement_grant_insert_guard() RETURNS TRIGGER AS $$
DECLARE
  v_program entitlement_program%ROWTYPE;
  v_company UUID;
  v_privacy TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = NEW.approved_by AND active) THEN
    RAISE EXCEPTION 'entitlement_grant needs an active approver' USING ERRCODE = 'BV409';
  END IF;
  -- Governance (V1.0): anything broad (company-level, program-based) needs an elevated approver; an individual exception, an ADMIN.
  IF (NEW.company_id IS NOT NULL OR NEW.program_id IS NOT NULL) AND NOT entitlement_is_elevated(NEW.approved_by) THEN
    RAISE EXCEPTION 'a company-level or program-based grant needs an elevated (SUPER_ADMIN) approver' USING ERRCODE = 'BV409';
  END IF;
  -- Privacy beats commerce: nothing new is granted to a project whose access is blocked or that was anonymized.
  IF NEW.project_id IS NOT NULL THEN
    SELECT state INTO v_privacy FROM project_privacy_state WHERE project_id = NEW.project_id;
    IF v_privacy IN ('blocked', 'anonymized') THEN
      RAISE EXCEPTION 'project % is % for privacy reasons; no entitlement can be granted', NEW.project_id, v_privacy USING ERRCODE = 'BV409';
    END IF;
    SELECT company_id INTO v_company FROM project WHERE project_id = NEW.project_id;
  ELSE
    v_company := NEW.company_id;
  END IF;
  IF NEW.program_id IS NOT NULL THEN
    SELECT * INTO v_program FROM entitlement_program WHERE program_id = NEW.program_id;
    IF v_program.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'program % is not active', NEW.program_id USING ERRCODE = 'BV409';
    END IF;
    IF v_program.kind <> NEW.source THEN
      RAISE EXCEPTION 'a % grant cannot cite a % program', NEW.source, v_program.kind USING ERRCODE = 'BV409';
    END IF;
    IF v_program.max_redemptions IS NOT NULL
       AND (SELECT count(*) FROM entitlement_grant WHERE program_id = NEW.program_id AND extends_grant_id IS NULL) >= v_program.max_redemptions THEN
      RAISE EXCEPTION 'program % has no redemptions left', NEW.program_id USING ERRCODE = 'BV409';
    END IF;
    IF v_program.eligibility = 'listed'
       AND NOT EXISTS (SELECT 1 FROM entitlement_program_eligibility e WHERE e.program_id = NEW.program_id AND e.company_id = v_company) THEN
      RAISE EXCEPTION 'the company is not eligible for program %', NEW.program_id USING ERRCODE = 'BV409';
    END IF;
  END IF;
  IF NEW.extends_grant_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM entitlement_grant p
       WHERE p.grant_id = NEW.extends_grant_id AND p.terminated_at IS NULL
         AND p.project_id IS NOT DISTINCT FROM NEW.project_id AND p.company_id IS NOT DISTINCT FROM NEW.company_id
         AND NEW.starts_at >= p.starts_at
    ) THEN
      RAISE EXCEPTION 'a grant can only extend a non-terminated grant of the same project or company' USING ERRCODE = 'BV409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_grant_insert_guard_trigger BEFORE INSERT ON entitlement_grant
  FOR EACH ROW EXECUTE FUNCTION entitlement_grant_insert_guard();--> statement-breakpoint

-- =========================================================================
-- 8. Programs (rules), sponsors (payers) and eligibility (the sponsor's selection)
-- =========================================================================
CREATE FUNCTION entitlement_program_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entitlement_program rows are never deleted (%)', OLD.program_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'entitlement_program % identity is immutable', OLD.program_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('active', 'closed')) OR (OLD.status = 'active' AND NEW.status = 'closed')) THEN
    RAISE EXCEPTION 'entitlement_program % cannot move from % to %', OLD.program_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'active' AND OLD.status = 'draft' AND NOT entitlement_is_elevated(NEW.approved_by) THEN
    RAISE EXCEPTION 'a program is approved by an elevated (SUPER_ADMIN) admin' USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id OR NEW.agreement_ref IS DISTINCT FROM OLD.agreement_ref
    OR NEW.market_scope IS DISTINCT FROM OLD.market_scope OR NEW.grant_days IS DISTINCT FROM OLD.grant_days
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.max_redemptions IS DISTINCT FROM OLD.max_redemptions OR NEW.eligibility IS DISTINCT FROM OLD.eligibility
    OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'entitlement_program % terms are frozen once it leaves draft', OLD.program_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'closed' AND OLD.status = 'closed' AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'entitlement_program % close time is write-once', OLD.program_id USING ERRCODE = 'BV409';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_program_guard_trigger BEFORE UPDATE OR DELETE ON entitlement_program
  FOR EACH ROW EXECUTE FUNCTION entitlement_program_guard();--> statement-breakpoint
CREATE TRIGGER entitlement_program_no_truncate BEFORE TRUNCATE ON entitlement_program
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();--> statement-breakpoint

CREATE FUNCTION entitlement_eligibility_guard() RETURNS TRIGGER AS $$
DECLARE
  v_program entitlement_program%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'entitlement_program_eligibility is append-only' USING ERRCODE = 'BV409';
  END IF;
  SELECT * INTO v_program FROM entitlement_program WHERE program_id = NEW.program_id;
  IF v_program.eligibility <> 'listed' OR v_program.status = 'closed' THEN
    RAISE EXCEPTION 'only a listed, not-closed program has an eligibility list' USING ERRCODE = 'BV409';
  END IF;
  IF NOT entitlement_is_elevated(NEW.created_by) THEN
    RAISE EXCEPTION 'the eligibility list is managed by an elevated (SUPER_ADMIN) admin' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_eligibility_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON entitlement_program_eligibility
  FOR EACH ROW EXECUTE FUNCTION entitlement_eligibility_guard();--> statement-breakpoint
CREATE TRIGGER entitlement_eligibility_no_truncate BEFORE TRUNCATE ON entitlement_program_eligibility
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();--> statement-breakpoint

CREATE FUNCTION sponsor_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sponsor rows are never deleted (%)', OLD.sponsor_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT entitlement_is_elevated(NEW.created_by) THEN
      RAISE EXCEPTION 'a sponsor is registered by an elevated (SUPER_ADMIN) admin' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id OR NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.country IS DISTINCT FROM OLD.country OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'sponsor % identity is immutable; only its status changes', OLD.sponsor_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sponsor_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON sponsor
  FOR EACH ROW EXECUTE FUNCTION sponsor_guard();--> statement-breakpoint
CREATE TRIGGER sponsor_no_truncate BEFORE TRUNCATE ON sponsor
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();--> statement-breakpoint

-- =========================================================================
-- 9. Privacy state: append-only ledger, forward-only transitions, derived current state
-- =========================================================================
CREATE VIEW project_privacy_state AS
  SELECT DISTINCT ON (e.project_id)
         e.project_id,
         CASE e.event WHEN 'access_blocked' THEN 'blocked' WHEN 'anonymized' THEN 'anonymized' ELSE 'open' END AS state,
         e.reason_code,
         e.created_at AS since
    FROM project_privacy_event e
   ORDER BY e.project_id, e.seq DESC;--> statement-breakpoint

CREATE FUNCTION project_privacy_event_guard() RETURNS TRIGGER AS $$
DECLARE
  v_state TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'project_privacy_event is an append-only ledger' USING ERRCODE = 'BV409';
  END IF;
  SELECT state INTO v_state FROM project_privacy_state WHERE project_id = NEW.project_id;
  v_state := COALESCE(v_state, 'open');
  IF v_state = 'anonymized' THEN
    RAISE EXCEPTION 'project % was anonymized; nothing follows' , NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.event = 'access_blocked' AND v_state <> 'open' THEN
    RAISE EXCEPTION 'project % access is already blocked', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.event = 'access_restored' AND v_state <> 'blocked' THEN
    RAISE EXCEPTION 'project % has no access block to lift', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER project_privacy_event_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON project_privacy_event
  FOR EACH ROW EXECUTE FUNCTION project_privacy_event_guard();--> statement-breakpoint
CREATE TRIGGER project_privacy_event_no_truncate BEFORE TRUNCATE ON project_privacy_event
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();
--> statement-breakpoint

-- =========================================================================
-- 10. SUPER_ADMIN counts as an administrator for the "never leave no active admin" rule (0012)
-- =========================================================================
CREATE OR REPLACE FUNCTION admin_user_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_user rows are never deleted (deactivate instead)' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.admin_user_id <> OLD.admin_user_id OR NEW.auth_identity <> OLD.auth_identity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'admin_user % identity is immutable', OLD.admin_user_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.auth_subject IS NOT NULL AND (NEW.auth_issuer IS DISTINCT FROM OLD.auth_issuer OR NEW.auth_subject IS DISTINCT FROM OLD.auth_subject) THEN
    RAISE EXCEPTION 'admin_user % is already bound to its identity-provider subject', OLD.admin_user_id USING ERRCODE = 'BV409';
  END IF;
  -- Never leave the Control Center without an active, login-enabled ADMIN or SUPER_ADMIN once one exists.
  IF OLD.role::text IN ('ADMIN', 'SUPER_ADMIN') AND OLD.active AND OLD.login_enabled
     AND NOT (NEW.role::text IN ('ADMIN', 'SUPER_ADMIN') AND NEW.active AND NEW.login_enabled)
     AND NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id <> OLD.admin_user_id AND role::text IN ('ADMIN', 'SUPER_ADMIN') AND active AND login_enabled) THEN
    RAISE EXCEPTION 'the last active login-enabled ADMIN cannot be deactivated, demoted or disabled' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
