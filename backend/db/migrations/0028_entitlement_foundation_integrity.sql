-- Macroblock C — Premium entitlement foundation: integrity rules the Drizzle DSL cannot express (follows 0027).
--
-- What this migration does:
--   1. premium_access_source (view): ONE uniform list of every source of Premium access — the existing paid
--      `subscription` periods (source 'paid') UNION the new `entitlement_grant` rows (complimentary, promotion, trial,
--      manual, partner). Paid access did not move: the subscription lifecycle, its idempotency and its sweep are untouched.
--   2. entitlement_recompute(project, now): the single derivation of the `entitlement` row (the projection Precision reads)
--      from ALL sources. Same state machine and constraints as 0022 (FULL -> READ_ONLY -> REVOKED, or back to FULL).
--      Paid sources follow their lifecycle status (never the clock, as before); grants are clock-bound.
--   3. The subscription -> entitlement trigger (0022) now keeps the transition history and calls entitlement_recompute();
--      a new trigger does the same for grants (a company grant fans out to the company's locked projects).
--   4. Guards: grants and campaigns are never deleted; a grant's terms are immutable (only a write-once termination);
--      an inserted grant needs an active approver and, if it cites a campaign, an ACTIVE campaign of the same kind;
--      campaign terms freeze once it leaves draft.
--
-- Revert (manual; one transaction, newest first). Grant/campaign data is lost on DROP:
--   BEGIN;
--   DROP TRIGGER IF EXISTS entitlement_grant_sync_trigger ON entitlement_grant;
--   DROP FUNCTION IF EXISTS entitlement_grant_sync();
--   DROP TRIGGER IF EXISTS entitlement_grant_insert_guard_trigger ON entitlement_grant;
--   DROP FUNCTION IF EXISTS entitlement_grant_insert_guard();
--   DROP TRIGGER IF EXISTS entitlement_grant_guard_trigger ON entitlement_grant;
--   DROP TRIGGER IF EXISTS entitlement_grant_no_truncate ON entitlement_grant;
--   DROP FUNCTION IF EXISTS entitlement_grant_guard();
--   DROP TRIGGER IF EXISTS promotion_campaign_guard_trigger ON promotion_campaign;
--   DROP TRIGGER IF EXISTS promotion_campaign_no_truncate ON promotion_campaign;
--   DROP FUNCTION IF EXISTS promotion_campaign_guard();
--   DROP FUNCTION IF EXISTS entitlement_ledger_truncate_guard();
--   -- restore the 0022 body of subscription_sync_entitlement_and_history() (CREATE OR REPLACE from 0022), then:
--   DROP FUNCTION IF EXISTS entitlement_recompute(UUID, TIMESTAMPTZ);
--   DROP VIEW IF EXISTS premium_access_source;
--   DROP TABLE entitlement_grant, promotion_campaign;
--   DELETE FROM drizzle.__drizzle_migrations WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 2);
--   COMMIT;

-- =========================================================================
-- 1. The uniform list of access sources
-- =========================================================================
CREATE VIEW premium_access_source AS
  SELECT s.subscription_id::text AS source_ref,
         'paid'::text AS source,
         s.project_id,
         NULL::uuid AS company_id,
         NULL::uuid AS grant_id,
         NULL::uuid AS campaign_id,
         s.current_period_start AS starts_at,
         s.current_period_end AS ends_at,
         -- A closed (PREMIUM_INACTIVE) period ends when it was ended; otherwise at the end of the paid period.
         CASE WHEN s.status = 'PREMIUM_INACTIVE' THEN COALESCE(s.ended_at, s.current_period_end) ELSE s.current_period_end END AS effective_end,
         (s.status = 'PREMIUM_INACTIVE') AS closed,
         -- Legacy projection: an active (not cancelling) paid period has no fixed `effective_until`.
         (s.status = 'PREMIUM_ACTIVE') AS open_ended,
         -- Paid access follows its own lifecycle (events / sweep), not the database clock.
         false AS clock_bound
    FROM subscription s
  UNION ALL
  SELECT g.grant_id::text,
         g.source,
         g.project_id,
         g.company_id,
         g.grant_id,
         g.campaign_id,
         g.starts_at,
         g.ends_at,
         LEAST(g.ends_at, COALESCE(g.terminated_at, g.ends_at)),
         (g.terminated_at IS NOT NULL),
         false,
         true
    FROM entitlement_grant g;--> statement-breakpoint

-- =========================================================================
-- 2. The single derivation of the entitlement projection
-- =========================================================================
CREATE FUNCTION entitlement_recompute(p_project UUID, p_now TIMESTAMPTZ DEFAULT now()) RETURNS void AS $$
DECLARE
  v_company UUID;
  v_locked BOOLEAN;
  v_cur entitlement%ROWTYPE;
  v_found BOOLEAN;
  v_active BOOLEAN;
  v_open BOOLEAN;
  v_from TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
  v_last_end TIMESTAMPTZ;
  v_first_start TIMESTAMPTZ;
BEGIN
  SELECT company_id, (assessment_state = 'COMPLETED_LOCKED') INTO v_company, v_locked FROM project WHERE project_id = p_project;
  IF NOT FOUND THEN
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
        FROM premium_access_source
       WHERE (project_id = p_project OR company_id = v_company)
         -- Non-paid sources only count for a project whose First Assessment is completed and locked.
         AND (NOT clock_bound OR v_locked)
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
-- 3. Triggers: paid sources (subscription) and grants both go through the same derivation
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

-- =========================================================================
-- 4a. Grants and campaigns are never deleted or truncated
-- =========================================================================
CREATE FUNCTION entitlement_ledger_truncate_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is an append-only ledger and cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- =========================================================================
-- 4b. entitlement_grant: terms immutable; termination is write-once; insert needs an active approver / active campaign
-- =========================================================================
CREATE FUNCTION entitlement_grant_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entitlement_grant rows are never deleted (%)', OLD.grant_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.market_scope IS DISTINCT FROM OLD.market_scope OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
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
  v_campaign promotion_campaign%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_user WHERE admin_user_id = NEW.approved_by AND active) THEN
    RAISE EXCEPTION 'entitlement_grant needs an active approver' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM promotion_campaign WHERE campaign_id = NEW.campaign_id;
    IF v_campaign.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'campaign % is not active', NEW.campaign_id USING ERRCODE = 'BV409';
    END IF;
    IF v_campaign.kind <> NEW.source THEN
      RAISE EXCEPTION 'a % grant cannot cite a % campaign', NEW.source, v_campaign.kind USING ERRCODE = 'BV409';
    END IF;
    IF v_campaign.max_redemptions IS NOT NULL
       AND (SELECT count(*) FROM entitlement_grant WHERE campaign_id = NEW.campaign_id) >= v_campaign.max_redemptions THEN
      RAISE EXCEPTION 'campaign % has no redemptions left', NEW.campaign_id USING ERRCODE = 'BV409';
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
-- 4c. promotion_campaign: never deleted; status forward-only; terms freeze when it leaves draft
-- =========================================================================
CREATE FUNCTION promotion_campaign_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'promotion_campaign rows are never deleted (%)', OLD.campaign_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'promotion_campaign % identity is immutable', OLD.campaign_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('active', 'closed')) OR (OLD.status = 'active' AND NEW.status = 'closed')) THEN
    RAISE EXCEPTION 'promotion_campaign % cannot move from % to %', OLD.campaign_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.market_scope IS DISTINCT FROM OLD.market_scope OR NEW.grant_days IS DISTINCT FROM OLD.grant_days
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.max_redemptions IS DISTINCT FROM OLD.max_redemptions OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'promotion_campaign % terms are frozen once it leaves draft', OLD.campaign_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'closed' AND OLD.status = 'closed' AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'promotion_campaign % close time is write-once', OLD.campaign_id USING ERRCODE = 'BV409';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER promotion_campaign_guard_trigger BEFORE UPDATE OR DELETE ON promotion_campaign
  FOR EACH ROW EXECUTE FUNCTION promotion_campaign_guard();--> statement-breakpoint
CREATE TRIGGER promotion_campaign_no_truncate BEFORE TRUNCATE ON promotion_campaign
  FOR EACH STATEMENT EXECUTE FUNCTION entitlement_ledger_truncate_guard();
