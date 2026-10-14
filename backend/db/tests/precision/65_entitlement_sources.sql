-- Included by run_precision_tests.sql. Premium entitlement foundation (migrations 0027/0028): access sources (paid / grants),
-- the single derivation entitlement_recompute(), programs + sponsors + eligibility, company-level scope, governance by role,
-- the stacking rule, immutability, and the privacy ledger. The point under test: the entitlement Precision reads is the SAME
-- whatever the source, paid behaviour is unchanged, and privacy can override commerce.

CREATE FUNCTION pg_temp.locked_project(p_name TEXT) RETURNS UUID AS $$
DECLARE v UUID := pg_temp.new_project(p_name);
BEGIN
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = v;
  RETURN v;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.new_admin(p_label TEXT, p_role TEXT) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  INSERT INTO admin_user (role, auth_identity) VALUES (p_role::admin_role, p_label || '@beeside.internal') RETURNING admin_user_id INTO v;
  RETURN v;
END $$ LANGUAGE plpgsql;

\echo '--- E01-E09: grants and the single derivation (individual exceptions, ADMIN) ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eone');
  q UUID := pg_temp.new_project('Etwo');          -- First Assessment NOT locked
  sup0 UUID := pg_temp.new_admin('pt-super0', 'SUPER_ADMIN');
  g UUID; g2 UUID; e entitlement%ROWTYPE;
BEGIN
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'complimentary', now() - interval '1 day', now() + interval '60 days', 'launch partner demo', adm, 'admin:' || adm) RETURNING grant_id INTO g;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E01', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.effective_until IS NOT NULL
    AND e.premium_ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM subscription WHERE project_id = p), 'a grant alone yields FULL with a dated end, no subscription');

  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (q, 'manual', now() - interval '1 day', now() + interval '60 days', 'support exception', adm, 'admin:' || adm);
  PERFORM pg_temp.assert_that('E02', NOT EXISTS (SELECT 1 FROM entitlement WHERE project_id = q), 'non-paid access never opens before the First Assessment is locked');
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = q;
  PERFORM pg_temp.assert_that('E02b', (SELECT precision_access_mode FROM entitlement WHERE project_id = q) = 'FULL', 'locking the First Assessment applies the grant that was waiting (no sweep needed)');

  PERFORM pg_temp.expect_error('E03a', format($q$UPDATE entitlement_grant SET ends_at = ends_at + interval '30 days' WHERE grant_id = %L$q$, g), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('E03b', format($q$DELETE FROM entitlement_grant WHERE grant_id = %L$q$, g), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('E03c', 'TRUNCATE entitlement_grant', 'BV409', NULL);

  PERFORM pg_temp.expect_error('E04a', format($q$UPDATE entitlement_grant SET terminated_at = now() + interval '90 days', terminated_by = %L, termination_reason = 'x' WHERE grant_id = %L$q$, adm, g), 'BV409', NULL);
  UPDATE entitlement_grant SET terminated_at = now(), terminated_by = adm, termination_reason = 'granted by mistake' WHERE grant_id = g;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E04b', NOT e.premium_access_active AND e.precision_access_mode = 'READ_ONLY' AND e.premium_ended_at IS NOT NULL,
    'terminating the only source -> READ_ONLY from the termination, exactly like the end of a paid period');
  PERFORM pg_temp.expect_error('E04c', format($q$UPDATE entitlement_grant SET termination_reason = 'rewrite' WHERE grant_id = %L$q$, g), 'BV409', NULL);

  PERFORM pg_temp.expect_error('E05a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, extends_grant_id) VALUES (%L, 'complimentary', now(), now() + interval '30 days', 'r', %L, 'admin', %L)$q$, p, adm, g), 'BV409', 'extend');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'complimentary', now() - interval '1 hour', now() + interval '30 days', 're-granted after review', adm, 'admin:' || adm) RETURNING grant_id INTO g2;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E05b', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.premium_ended_at IS NULL AND e.readonly_until IS NULL,
    'a new grant on an ended entitlement returns it to FULL (same rule as a new payment)');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, extends_grant_id)
    VALUES (p, 'complimentary', now() + interval '30 days', now() + interval '60 days', 'extension agreed with partner', adm, 'admin', g2);
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E05c', e.precision_access_mode = 'FULL' AND e.effective_until > now() + interval '25 days' AND e.effective_until <= now() + interval '31 days',
    'a future-dated extension does not change access until it starts; the original grant row is unchanged');

  PERFORM pg_temp.expect_error('E06a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'manual', now(), now() + interval '1 day', '  ', %L, 'admin')$q$, p, adm), '23514', 'entitlement_grant_reason');
  PERFORM pg_temp.expect_error('E06b', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'manual', now(), now() + interval '1 day', 'r', gen_random_uuid(), 'admin')$q$, p), 'BV409', 'approver');
  PERFORM pg_temp.expect_error('E07a', format($q$INSERT INTO entitlement_grant (project_id, company_id, company_scope, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, (SELECT company_id FROM project WHERE project_id = %L), 'current_projects', 'manual', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, p, p, sup0), '23514', 'entitlement_grant_scope');
  PERFORM pg_temp.expect_error('E07b', format($q$INSERT INTO entitlement_grant (source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES ('manual', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, adm), '23514', 'entitlement_grant_scope');
  PERFORM pg_temp.expect_error('E08a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, p, adm), '23514', 'entitlement_grant_program_required');
  PERFORM pg_temp.expect_error('E08b', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'sponsored', now(), now() + interval '1 day', 'r', %L, 'admin')$q$, p, adm), '23514', 'entitlement_grant_program_required');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, idempotency_key)
    VALUES (p, 'manual', now(), now() + interval '2 days', 'r', adm, 'admin', 'idem-e09');
  PERFORM pg_temp.expect_error('E09', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, idempotency_key) VALUES (%L, 'manual', now(), now() + interval '2 days', 'r', %L, 'admin', 'idem-e09')$q$, p, adm), '23505', NULL);
END $t$;

\echo '--- E10-E24: sponsors, programs (rules), eligibility, governance by role ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  sup UUID := pg_temp.new_admin('pt-super', 'SUPER_ADMIN');
  sp UUID; pr UUID; pr2 UUID;
  p1 UUID := pg_temp.locked_project('Ethree'); p2 UUID := pg_temp.locked_project('Efour'); p3 UUID := pg_temp.locked_project('Efive'); p4 UUID := pg_temp.locked_project('Esix');
  c1 UUID; c4 UUID; e entitlement%ROWTYPE;
BEGIN
  SELECT company_id INTO c1 FROM project WHERE project_id = p1;
  SELECT company_id INTO c4 FROM project WHERE project_id = p4;

  -- E10 a sponsor (the payer) is registered by an elevated admin only
  PERFORM pg_temp.expect_error('E10a', format($q$INSERT INTO sponsor (name, kind, country, created_by) VALUES ('Scottish Development Agency', 'agency', 'GB', %L)$q$, adm), 'BV409', 'elevated');
  INSERT INTO sponsor (name, kind, country, created_by) VALUES ('Scottish Development Agency', 'agency', 'GB', sup) RETURNING sponsor_id INTO sp;
  PERFORM pg_temp.assert_that('E10b', sp IS NOT NULL, 'a sponsor is its own business entity (not a user, not a Stripe customer)');
  PERFORM pg_temp.expect_error('E10c', format($q$UPDATE sponsor SET name = 'x' WHERE sponsor_id = %L$q$, sp), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('E10d', format($q$DELETE FROM sponsor WHERE sponsor_id = %L$q$, sp), 'BV409', 'never deleted');

  -- E11 a sponsored program needs its sponsor; others forbid one
  PERFORM pg_temp.expect_error('E11a', format($q$INSERT INTO entitlement_program (code, name, kind, grant_days, starts_at, ends_at, reason, created_by) VALUES ('sponsored-no-payer', 'x', 'sponsored', 90, now(), now() + interval '30 days', 'r', %L)$q$, adm), '23514', 'entitlement_program_sponsor');
  PERFORM pg_temp.expect_error('E11b', format($q$INSERT INTO entitlement_program (code, name, kind, sponsor_id, grant_days, starts_at, ends_at, reason, created_by) VALUES ('promo-with-payer', 'x', 'promotion', %L, 90, now(), now() + interval '30 days', 'r', %L)$q$, sp, adm), '23514', 'entitlement_program_sponsor');
  INSERT INTO entitlement_program (code, name, kind, sponsor_id, agreement_ref, market_scope, grant_days, starts_at, ends_at, max_redemptions, eligibility, reason, created_by)
    VALUES ('scot-export-2026', 'Scottish export programme', 'sponsored', sp, 'AGR-2026-014', ARRAY['GB'], 365, now() - interval '1 day', now() + interval '90 days', 2, 'listed', 'economic development programme', adm) RETURNING program_id INTO pr;

  -- E12 a draft program cannot be redeemed; activation needs an ELEVATED approver
  PERFORM pg_temp.expect_error('E12a', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'sponsored', %L, now(), now() + interval '365 days', 'r', %L, 'x')$q$, p1, pr, sup), 'BV409', 'not active');
  PERFORM pg_temp.expect_error('E12b', format($q$UPDATE entitlement_program SET status = 'active', approved_by = %L WHERE program_id = %L$q$, adm, pr), 'BV409', 'elevated');
  INSERT INTO entitlement_program_eligibility (program_id, company_id, created_by) VALUES (pr, c1, sup);
  PERFORM pg_temp.expect_error('E12c', format($q$INSERT INTO entitlement_program_eligibility (program_id, company_id, created_by) VALUES (%L, %L, %L)$q$, pr, c4, adm), 'BV409', 'elevated');
  UPDATE entitlement_program SET status = 'active', approved_by = sup WHERE program_id = pr;
  PERFORM pg_temp.expect_error('E12d', format($q$UPDATE entitlement_program SET grant_days = 30 WHERE program_id = %L$q$, pr), 'BV409', 'frozen');
  PERFORM pg_temp.expect_error('E12e', format($q$UPDATE entitlement_program SET sponsor_id = NULL WHERE program_id = %L$q$, pr), 'BV409', 'frozen');
  PERFORM pg_temp.expect_error('E12f', format($q$DELETE FROM entitlement_program WHERE program_id = %L$q$, pr), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('E12g', format($q$UPDATE entitlement_program_eligibility SET created_by = %L WHERE program_id = %L$q$, sup, pr), 'BV409', 'append-only');

  -- E13 sponsored redemption: only listed companies; the beneficiary keeps its OWN project; no subscription exists
  INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, market_scope, reason, approved_by, created_by_actor)
    VALUES (p1, 'sponsored', pr, now(), now() + interval '365 days', ARRAY['GB'], 'programme beneficiary', sup, 'system:redeem');
  SELECT * INTO e FROM entitlement WHERE project_id = p1;
  PERFORM pg_temp.assert_that('E13a', e.premium_access_active AND e.precision_access_mode = 'FULL' AND NOT EXISTS (SELECT 1 FROM subscription WHERE project_id = p1),
    'a sponsored beneficiary gets FULL with no payment of its own');
  PERFORM pg_temp.expect_error('E13b', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'sponsored', %L, now(), now() + interval '365 days', 'r', %L, 'x')$q$, p2, pr, sup), 'BV409', 'not eligible');
  PERFORM pg_temp.expect_error('E13c', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'sponsored', %L, now(), now() + interval '365 days', 'r', %L, 'x')$q$, p1, pr, sup), '23505', NULL);

  -- E14 governance: a program-based or company-level grant approved by a plain ADMIN is refused
  PERFORM pg_temp.expect_error('E14a', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'sponsored', %L, now(), now() + interval '365 days', 'r', %L, 'x')$q$, p2, pr, adm), 'BV409', 'elevated');
  PERFORM pg_temp.expect_error('E14b', format($q$INSERT INTO entitlement_grant (company_id, company_scope, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'current_projects', 'partner', now(), now() + interval '30 days', 'r', %L, 'x')$q$, c1, adm), 'BV409', 'elevated');

  -- E15 quota is a cap on beneficiaries; closing a program does not revoke what it issued
  INSERT INTO entitlement_program (code, name, kind, grant_days, starts_at, ends_at, max_redemptions, reason, created_by)
    VALUES ('mx-launch', 'Mexico launch', 'promotion', 45, now() - interval '1 day', now() + interval '30 days', 1, 'market opening', adm) RETURNING program_id INTO pr2;
  UPDATE entitlement_program SET status = 'active', approved_by = sup WHERE program_id = pr2;
  INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p2, 'promotion', pr2, now(), now() + interval '45 days', 'program:mx-launch', sup, 'system:redeem');
  PERFORM pg_temp.expect_error('E15a', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'promotion', %L, now(), now() + interval '45 days', 'r', %L, 'x')$q$, p3, pr2, sup), 'BV409', 'no redemptions left');
  PERFORM pg_temp.expect_error('E15b', format($q$INSERT INTO entitlement_grant (project_id, source, program_id, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'trial', %L, now(), now() + interval '9 days', 'r', %L, 'x')$q$, p3, pr2, sup), 'BV409', 'cannot cite');
  UPDATE entitlement_program SET status = 'closed', closed_at = now() WHERE program_id = pr2;
  PERFORM pg_temp.assert_that('E15c', (SELECT precision_access_mode FROM entitlement WHERE project_id = p2) = 'FULL', 'closing a program does not revoke grants already issued');
  PERFORM pg_temp.expect_error('E15d', format($q$UPDATE entitlement_program SET status = 'active', closed_at = NULL WHERE program_id = %L$q$, pr2), 'BV409', NULL);
END $t$;

\echo '--- E30-E39: company-level grants are explicit and scoped (project first) ---'
DO $t$
DECLARE
  sup UUID := pg_temp.new_admin('pt-super2', 'SUPER_ADMIN');
  co UUID; a UUID; b UUID; c UUID;
  ga UUID;
BEGIN
  -- one company with two projects that exist now
  a := pg_temp.locked_project('Ecoa');
  SELECT company_id INTO co FROM project WHERE project_id = a;
  UPDATE project SET created_at = now() - interval '2 days' WHERE project_id = a;
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Ecob', 'Person', 'ecob-pt@beeside-test.invalid', 'en', 'en', 'en');
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version, created_at)
    SELECT co, person_id, person_id, current_setting('pt.qb'), current_setting('pt.re'), current_setting('pt.st'), now() - interval '1 day' FROM person WHERE primary_email = 'ecob-pt@beeside-test.invalid'
    RETURNING project_id INTO b;
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = b;

  -- E30 scope is mandatory for a company grant, forbidden for a project grant
  PERFORM pg_temp.expect_error('E30a', format($q$INSERT INTO entitlement_grant (company_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'partner', now(), now() + interval '30 days', 'r', %L, 'x')$q$, co, sup), '23514', 'entitlement_grant_company_scope');
  PERFORM pg_temp.expect_error('E30b', format($q$INSERT INTO entitlement_grant (project_id, company_scope, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'current_projects', 'manual', now(), now() + interval '30 days', 'r', %L, 'x')$q$, a, sup), '23514', 'entitlement_grant_company_scope');
  PERFORM pg_temp.expect_error('E30c', format($q$INSERT INTO entitlement_grant (project_id, max_projects, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 3, 'manual', now(), now() + interval '30 days', 'r', %L, 'x')$q$, a, sup), '23514', 'entitlement_grant_max_projects');

  -- E31 current_projects: covers the projects that exist NOW, never a project created afterwards
  INSERT INTO entitlement_grant (company_id, company_scope, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (co, 'current_projects', 'partner', now() - interval '1 day', now() + interval '90 days', 'channel partner agreement', sup, 'admin') RETURNING grant_id INTO ga;
  PERFORM pg_temp.assert_that('E31a', (SELECT precision_access_mode FROM entitlement WHERE project_id = a) = 'FULL' AND (SELECT precision_access_mode FROM entitlement WHERE project_id = b) = 'FULL',
    'a company grant (current_projects) opens every project that existed when it was issued');
  INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
    VALUES ('Ecoc', 'Person', 'ecoc-pt@beeside-test.invalid', 'en', 'en', 'en');
  INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version, created_at)
    SELECT co, person_id, person_id, current_setting('pt.qb'), current_setting('pt.re'), current_setting('pt.st'), now() + interval '1 day' FROM person WHERE primary_email = 'ecoc-pt@beeside-test.invalid'
    RETURNING project_id INTO c;
  UPDATE project SET assessment_state = 'COMPLETED_LOCKED' WHERE project_id = c;
  PERFORM pg_temp.assert_that('E31b', NOT EXISTS (SELECT 1 FROM entitlement WHERE project_id = c),
    'a project created AFTER a current_projects agreement does not inherit free access (no unlimited company-wide Premium by default)');

  -- E32 projects_created_in_period + cap: first N projects created inside the window
  UPDATE entitlement_grant SET terminated_at = now(), terminated_by = sup, termination_reason = 'replaced by period agreement' WHERE grant_id = ga;
  INSERT INTO entitlement_grant (company_id, company_scope, max_projects, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (co, 'projects_created_in_period', 1, 'partner', now() - interval '1 second', now() + interval '90 days', 'one project per agreement window', sup, 'admin');
  PERFORM pg_temp.assert_that('E32a', NOT EXISTS (SELECT 1 FROM entitlement_sources_for(a) WHERE source = 'partner' AND NOT closed)
    AND NOT EXISTS (SELECT 1 FROM entitlement_sources_for(b) WHERE source = 'partner' AND NOT closed), 'projects created BEFORE the window are outside a projects_created_in_period agreement');
  PERFORM pg_temp.assert_that('E32b', EXISTS (SELECT 1 FROM entitlement_sources_for(c) WHERE source = 'partner' AND NOT closed),
    'a project created inside the window is covered (cap 1: the earliest created in the window)');
END $t$;

\echo '--- E40-E46: the stacking rule (a paid term starts when the access already held ends) ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eseven'); s UUID; g UUID; e entitlement%ROWTYPE; cu TIMESTAMPTZ; t0 TIMESTAMPTZ := now();
BEGIN
  PERFORM pg_temp.assert_that('E40', entitlement_covered_until(p, t0) = t0, 'no access held -> covered until now (the paid term starts now)');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'trial', t0 - interval '1 day', t0 + interval '20 days', 'trial', adm, 'admin') RETURNING grant_id INTO g;
  cu := entitlement_covered_until(p, t0);
  PERFORM pg_temp.assert_that('E41', cu = t0 + interval '20 days', 'free access held -> covered until its end');
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor, extends_grant_id)
    VALUES (p, 'trial', t0 + interval '20 days', t0 + interval '35 days', 'chained', adm, 'admin', g);
  PERFORM pg_temp.assert_that('E42', entitlement_covered_until(p, t0) = t0 + interval '35 days', 'a chained grant continues the coverage');
  -- the paid term is placed AFTER the held access
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (p, 'PREMIUM_ACTIVE', t0 + interval '35 days', t0 + interval '400 days') RETURNING subscription_id INTO s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E43', e.precision_access_mode = 'FULL' AND e.premium_access_active, 'payment during free access: FULL, one entitlement, no confusing overlap');
  PERFORM pg_temp.assert_that('E44', entitlement_covered_until(p, t0) = t0 + interval '400 days', 'coverage now runs through the paid term: free days kept, paid term not wasted');
  UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = t0 + interval '36 days' WHERE subscription_id = s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E45', e.precision_access_mode = 'FULL' OR e.precision_access_mode = 'READ_ONLY', 'ending the paid row is evaluated by the same derivation');
  PERFORM pg_temp.assert_that('E46', (SELECT count(*) FROM subscription_state_transition WHERE subscription_id = s) >= 2, 'paid transition history still written by the trigger');
END $t$;

\echo '--- E50-E58: sources are interchangeable for Precision; paid behaviour unchanged ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eeight'); s UUID; g UUID; e entitlement%ROWTYPE;
BEGIN
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'trial', now() - interval '1 day', now() + interval '20 days', 'trial', adm, 'admin') RETURNING grant_id INTO g;
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (p, 'PREMIUM_ACTIVE', now(), now() + interval '365 days') RETURNING subscription_id INTO s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E50a', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.effective_until IS NULL, 'payment during a grant: FULL, open-ended (paid period governs)');
  UPDATE entitlement_grant SET terminated_at = now(), terminated_by = adm, termination_reason = 'replaced by paid' WHERE grant_id = g;
  PERFORM pg_temp.assert_that('E50b', (SELECT precision_access_mode FROM entitlement WHERE project_id = p) = 'FULL', 'ending the grant leaves paid access intact');
  UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = now() - interval '1 day' WHERE subscription_id = s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E51', NOT e.premium_access_active AND e.precision_access_mode = 'READ_ONLY' AND e.premium_ended_at IS NOT NULL, 'with every source ended -> READ_ONLY');
  PERFORM pg_temp.assert_that('E52', (SELECT count(DISTINCT source) FROM premium_access_source WHERE project_id = p) = 2, 'premium_access_source lists paid and trial for the project');
  PERFORM entitlement_recompute(p); PERFORM entitlement_recompute(p);
  PERFORM pg_temp.assert_that('E53', (SELECT precision_access_mode FROM entitlement WHERE project_id = p) = 'READ_ONLY', 'recompute is idempotent and never moves backwards');
  DECLARE r UUID := pg_temp.locked_project('Enine'); BEGIN
    INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
      VALUES (r, 'manual', now() - interval '10 days', now() + interval '5 days', 'r', adm, 'admin');
    PERFORM pg_temp.assert_that('E54a', (SELECT precision_access_mode FROM entitlement WHERE project_id = r) = 'FULL', 'active inside the window');
    PERFORM entitlement_recompute(r, now() + interval '6 days');
    PERFORM pg_temp.assert_that('E54b', (SELECT precision_access_mode FROM entitlement WHERE project_id = r) = 'READ_ONLY', 'recompute at a later instant ends the grant (sweep path)');
  END;
END $t$;

\echo '--- E60-E68: privacy is separate from commerce and overrides it ---'
DO $t$
DECLARE
  adm UUID := current_setting('pt.admin')::uuid;
  p UUID := pg_temp.locked_project('Eten'); e entitlement%ROWTYPE;
BEGIN
  INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor)
    VALUES (p, 'manual', now() - interval '1 day', now() + interval '300 days', 'r', adm, 'admin');
  PERFORM pg_temp.assert_that('E60', NOT EXISTS (SELECT 1 FROM project_privacy_state WHERE project_id = p), 'no privacy event -> no row (state is open)');
  INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (p, 'access_blocked', 'erasure_request', 'admin:' || adm);
  PERFORM pg_temp.assert_that('E61', (SELECT state FROM project_privacy_state WHERE project_id = p) = 'blocked', 'access_blocked -> blocked');
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('E62', e.premium_access_active, 'the COMMERCIAL entitlement is untouched by privacy (separate concerns; the access layer applies the block)');
  PERFORM pg_temp.expect_error('E63a', format($q$INSERT INTO entitlement_grant (project_id, source, starts_at, ends_at, reason, approved_by, created_by_actor) VALUES (%L, 'manual', now(), now() + interval '9 days', 'r', %L, 'x')$q$, p, adm), 'BV409', 'privacy');
  PERFORM pg_temp.expect_error('E63b', format($q$INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (%L, 'access_blocked', 'other', 'x')$q$, p), 'BV409', 'already blocked');
  INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (p, 'access_restored', 'other', 'admin:' || adm);
  PERFORM pg_temp.assert_that('E64', (SELECT state FROM project_privacy_state WHERE project_id = p) = 'open', 'a block can be lifted (request withdrawn)');
  PERFORM pg_temp.expect_error('E65', format($q$INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (%L, 'access_restored', 'other', 'x')$q$, p), 'BV409', 'no access block');
  PERFORM pg_temp.expect_error('E65b', format($q$INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (%L, 'anonymized', 'erasure_request', 'x')$q$, p), 'BV409', 'only by privacy_erase_project');
  PERFORM set_config('app.privacy_erasure_project', p::text, true);  -- what privacy_erase_project() does as its last step
  INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (p, 'anonymized', 'erasure_request', 'admin:' || adm);
  PERFORM set_config('app.privacy_erasure_project', '', true);
  PERFORM pg_temp.assert_that('E66', (SELECT state FROM project_privacy_state WHERE project_id = p) = 'anonymized', 'anonymized is recorded');
  PERFORM pg_temp.expect_error('E67a', format($q$INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES (%L, 'access_restored', 'other', 'x')$q$, p), 'BV409', 'anonymized');
  PERFORM pg_temp.expect_error('E67b', format($q$UPDATE project_privacy_event SET reason_code = 'other' WHERE project_id = %L$q$, p), 'BV409', 'append-only');
  PERFORM pg_temp.expect_error('E67c', 'TRUNCATE project_privacy_event', 'BV409', NULL);
  PERFORM pg_temp.assert_that('E68', (SELECT count(*) FROM project_privacy_event WHERE project_id = p) = 3, 'the audit ledger keeps every step');
END $t$;
