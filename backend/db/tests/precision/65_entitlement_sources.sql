-- Included by run_precision_tests.sql. Macroblock C — Premium entitlement foundation (migrations 0027/0028):
-- access sources (paid / grants), the single derivation entitlement_recompute(), promotion campaigns, immutability.
-- The point under test: the entitlement Precision reads is the SAME whatever the source (paid, complimentary, promotion,
-- trial, manual, partner), and paid-access behaviour is unchanged.

\echo '--- E01-E12: grants and the single derivation ---'
CREATE FUNCTION pg_temp.locked_project(p_name TEXT) RETURNS UUID AS $$
DECLARE v UUID := pg_temp.new_project(p_name);
BEGIN
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v;
  RETURN v;
END $$ LANGUAGE plpgsql;

DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eone');
  q UUID := pg_temp.new_project('Etwo');          -- First Assessment NOT locked
  g UUID; g2 UUID; e entitlement%ROWTYPE;
BEGIN
  -- E01 a complimentary grant on a locked project -> FULL, dated end, no subscription involved
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'complimentary', now() - interval '1 day', now() + interval '60 days', 'launch partner demo', adm, 'admin:' || adm) RETURNING grant_id INTO g;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E01', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.effective_until IS NOT NULL
    AND e.premium_ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM subscription WHERE project_id = p), 'a grant alone yields FULL with a dated end, no subscription');

  -- E02 the same grant on a project whose FA is not locked grants nothing
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (q, 'manual', now() - interval '1 day', now() + interval '60 days', 'support exception', adm, 'admin:' || adm);
  PERFORM pg_temp.assert_that('E02', NOT EXISTS (SELECT 1 FROM entitlement WHERE project_id = q), 'non-paid access never opens before the First Assessment is locked');

  -- E03 terms are immutable; only a write-once termination is possible
  PERFORM pg_temp.expect_error('E03a', format($q$UPDATE entitlement_grant SET ends_at = ends_at + interval '30 days' WHERE grant_id = %L$q$, g), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('E03b', format($q$DELETE FROM entitlement_grant WHERE grant_id = %L$q$, g), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('E03c', 'TRUNCATE entitlement_grant', 'BV409', NULL);

  -- E04 early termination (reason + actor), future date rejected, write-once
  PERFORM pg_temp.expect_error('E04a', format($q$UPDATE entitlement_grant SET terminated_at = now() + interval '90 days', terminated_by = %L, termination_reason = 'x' WHERE grant_id = %L$q$, adm, g), 'BV409', NULL);
  UPDATE entitlement_grant SET terminated_at = now(), terminated_by = adm, termination_reason = 'granted by mistake' WHERE grant_id = g;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E04b', NOT e.premium_access_active AND e.precision_access_mode = 'READ_ONLY' AND e.premium_ended_at IS NOT NULL,
    'terminating the only source -> READ_ONLY from the termination, exactly like the end of a paid period');
  PERFORM pg_temp.expect_error('E04c', format($q$UPDATE entitlement_grant SET termination_reason = 'rewrite' WHERE grant_id = %L$q$, g), 'BV409', NULL);

  -- E05 a terminated grant cannot be "extended" (it is a new decision: a fresh grant); access returns to FULL like a new payment
  PERFORM pg_temp.expect_error('E05a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, extends_grant_id) VALUES (%L, 'complimentary', now(), now() + interval '30 days', 'r', %L, 'admin', %L)$q$, p, adm, g), 'BV409', 'extend');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'complimentary', now() - interval '1 hour', now() + interval '30 days', 're-granted after review', adm, 'admin:' || adm) RETURNING grant_id INTO g2;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E05b', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.premium_ended_at IS NULL AND e.readonly_until IS NULL,
    'a new grant on an ended entitlement returns it to FULL (same rule as a new payment)');
  -- extending a live grant = a new chained grant; the chain is visible, the original is untouched
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, extends_grant_id)
    VALUES (p, 'complimentary', now() + interval '30 days', now() + interval '60 days', 'extension agreed with partner', adm, 'admin', g2);
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E05c', e.precision_access_mode = 'FULL' AND e.effective_until > now() + interval '25 days' AND e.effective_until <= now() + interval '31 days',
    'a future-dated extension does not change access until it starts; the original grant row is unchanged');

  -- E06 a reason and an active approver are mandatory
  PERFORM pg_temp.expect_error('E06a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'manual', now(), now() + interval '1 day', '  ', %L, 'admin')$q$, p, adm), '23514', 'entitlement_grant_reason');
  PERFORM pg_temp.expect_error('E06b', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'manual', now(), now() + interval '1 day', 'r', gen_random_uuid(), 'admin')$q$, p), 'BV409', 'approver');
  -- E07 exactly one scope
  PERFORM pg_temp.expect_error('E07a', format($q$INSERT INTO entitlement_grant (project_id, company_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, (SELECT company_id FROM project WHERE project_id = %L), 'manual', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, p, p, adm), '23514', 'entitlement_grant_scope');
  PERFORM pg_temp.expect_error('E07b', format($q$INSERT INTO entitlement_grant (source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES ('manual', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, adm), '23514', 'entitlement_grant_scope');
  -- E08 a promotion cites a campaign
  PERFORM pg_temp.expect_error('E08', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, p, adm), '23514', 'entitlement_grant_promotion_has_campaign');
  -- E09 the idempotency key makes a retry safe
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, idempotency_key)
    VALUES (p, 'manual', now(), now() + interval '2 days', 'r', adm, 'admin', 'idem-e09');
  PERFORM pg_temp.expect_error('E09', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, idempotency_key) VALUES (%L, 'manual', now(), now() + interval '2 days', 'r', %L, 'admin', 'idem-e09')$q$, p, adm), '23505', NULL);
END $t$;

\echo '--- E10-E19: promotion campaigns (rule) and company-scoped grants ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  adm2 UUID;
  c UUID; p1 UUID := pg_temp.locked_project('Ethree'); p2 UUID := pg_temp.locked_project('Efour'); p3 UUID := pg_temp.locked_project('Efive');
  e entitlement%ROWTYPE;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', 'pt-admin2@beeside.internal') RETURNING admin_user_id INTO adm2;
  INSERT INTO promotion_campaign (code, name, kind, market_scope, grant_days, starts_at, ends_at, max_redemptions, reason, created_by)
    VALUES ('mx-launch-2026', 'Mexico launch', 'promotion', ARRAY['MX'], 90, now() - interval '1 day', now() + interval '30 days', 2, 'market opening', adm) RETURNING campaign_id INTO c;
  PERFORM pg_temp.assert_that('E10', (SELECT status FROM promotion_campaign WHERE campaign_id = c) = 'draft', 'a campaign is born draft');

  -- E11 a draft campaign cannot be redeemed
  PERFORM pg_temp.expect_error('E11', format($q$INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', %L, now(), now() + interval '90 days', 'r', %L, 'admin')$q$, p1, c, adm), 'BV409', 'active');

  -- E12 activation needs an approver
  PERFORM pg_temp.expect_error('E12', format($q$UPDATE promotion_campaign SET status = 'active' WHERE campaign_id = %L$q$, c), '23514', 'promotion_campaign_active_is_approved');
  UPDATE promotion_campaign SET status = 'active', approved_by = adm2 WHERE campaign_id = c;
  PERFORM pg_temp.assert_that('E13a', (SELECT status FROM promotion_campaign WHERE campaign_id = c) = 'active', 'draft -> active with approver');
  PERFORM pg_temp.expect_error('E13b', format($q$UPDATE promotion_campaign SET grant_days = 365 WHERE campaign_id = %L$q$, c), 'BV409', 'frozen');
  PERFORM pg_temp.expect_error('E13c', format($q$UPDATE promotion_campaign SET status = 'draft' WHERE campaign_id = %L$q$, c), 'BV409', NULL);
  PERFORM pg_temp.expect_error('E13d', format($q$DELETE FROM promotion_campaign WHERE campaign_id = %L$q$, c), 'BV409', 'never deleted');

  -- E14 redemption -> FULL; once per project; quota enforced
  INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, market_scope, reason, approved_by, created_by_actor)
    VALUES (p1, 'promotion', c, now(), now() + interval '90 days', ARRAY['MX'], 'campaign redemption', adm2, 'system:redeem');
  SELECT * INTO e FROM entitlement WHERE project_id = p1;
  PERFORM pg_temp.assert_that('E14a', e.premium_access_active AND e.precision_access_mode = 'FULL', 'a campaign redemption opens FULL');
  PERFORM pg_temp.expect_error('E14b', format($q$INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', %L, now(), now() + interval '90 days', 'r', %L, 'x')$q$, p1, c, adm2), '23505', NULL);
  INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p2, 'promotion', c, now(), now() + interval '90 days', 'campaign redemption', adm2, 'system:redeem');
  PERFORM pg_temp.expect_error('E14c', format($q$INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', %L, now(), now() + interval '90 days', 'r', %L, 'x')$q$, p3, c, adm2), 'BV409', 'no redemptions left');

  -- E15 a campaign of another kind cannot be cited by a different source
  PERFORM pg_temp.expect_error('E15', format($q$INSERT INTO entitlement_grant (project_id, source, campaign_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'trial', %L, now(), now() + interval '9 days', 'r', %L, 'x')$q$, p3, c, adm2), 'BV409', NULL);

  -- E16 a company grant covers the company's locked projects (current and future)
  DECLARE co UUID; pa UUID := pg_temp.locked_project('Esix'); BEGIN
    SELECT company_id INTO co FROM project WHERE project_id = pa;
    INSERT INTO entitlement_grant (company_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
      VALUES (co, 'partner', now() - interval '1 day', now() + interval '40 days', 'channel partner', adm, 'admin');
    PERFORM pg_temp.assert_that('E16', (SELECT precision_access_mode FROM entitlement WHERE project_id = pa) = 'FULL', 'a company-scoped grant opens the company''s locked project');
  END;

  -- E17 closing a campaign is forward-only; existing grants are untouched
  UPDATE promotion_campaign SET status = 'closed', closed_at = now() WHERE campaign_id = c;
  PERFORM pg_temp.assert_that('E17a', (SELECT precision_access_mode FROM entitlement WHERE project_id = p1) = 'FULL', 'closing a campaign does not revoke grants already issued');
  PERFORM pg_temp.expect_error('E17b', format($q$UPDATE promotion_campaign SET status = 'active', closed_at = NULL WHERE campaign_id = %L$q$, c), 'BV409', NULL);
END $t$;

\echo '--- E20-E26: sources are interchangeable for Precision; paid behaviour unchanged ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eseven'); s UUID; g UUID; e entitlement%ROWTYPE;
BEGIN
  -- E20 free access first, then a payment arrives during it: still FULL, and the grant ending later does not drop access
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'trial', now() - interval '1 day', now() + interval '20 days', 'trial', adm, 'admin') RETURNING grant_id INTO g;
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (p, 'PREMIUM_ACTIVE', now(), now() + interval '365 days') RETURNING subscription_id INTO s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E20a', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.effective_until IS NULL, 'payment during a grant: FULL, open-ended (paid period governs)');
  -- terminating the grant does not touch paid access
  UPDATE entitlement_grant SET terminated_at = now(), terminated_by = adm, termination_reason = 'replaced by paid' WHERE grant_id = g;
  PERFORM pg_temp.assert_that('E20b', (SELECT precision_access_mode FROM entitlement WHERE project_id = p) = 'FULL', 'ending the grant leaves paid access intact');

  -- E21 paid ends -> READ_ONLY (unchanged 0022 behaviour)
  UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = now() - interval '1 day' WHERE subscription_id = s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E21', NOT e.premium_access_active AND e.precision_access_mode = 'READ_ONLY' AND e.premium_ended_at IS NOT NULL, 'with every source ended -> READ_ONLY');

  -- E22 the audit trail of states is kept in subscription_state_transition for paid; grants keep their own rows
  PERFORM pg_temp.assert_that('E22', (SELECT count(*) FROM subscription_state_transition WHERE subscription_id = s) >= 2, 'paid transition history still written by the trigger');

  -- E23 the uniform source list shows paid and grants together
  PERFORM pg_temp.assert_that('E23', (SELECT count(DISTINCT source) FROM premium_access_source WHERE project_id = p) = 2, 'premium_access_source lists paid and trial for the project');

  -- E24 recompute is idempotent
  PERFORM entitlement_recompute(p); PERFORM entitlement_recompute(p);
  PERFORM pg_temp.assert_that('E24', (SELECT precision_access_mode FROM entitlement WHERE project_id = p) = 'READ_ONLY', 'recompute is idempotent and never moves backwards');

  -- E25 clock: a grant that has run out is handled by recompute with an explicit "now"
  DECLARE r UUID := pg_temp.locked_project('Eeight'); BEGIN
    INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
      VALUES (r, 'manual', now() - interval '10 days', now() + interval '5 days', 'r', adm, 'admin');
    PERFORM pg_temp.assert_that('E25a', (SELECT precision_access_mode FROM entitlement WHERE project_id = r) = 'FULL', 'active inside the window');
    PERFORM entitlement_recompute(r, now() + interval '6 days');
    PERFORM pg_temp.assert_that('E25b', (SELECT precision_access_mode FROM entitlement WHERE project_id = r) = 'READ_ONLY', 'recompute at a later instant ends the grant (sweep path)');
  END;
END $t$;
