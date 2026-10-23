-- Included by run_precision_tests.sql. F5 Track B (Stripe) — migrations 0021/0022: Precision access mode on entitlement,
-- premium_checkout, billing_inbound_event, billing_alert. Setup (admin, fixtures, helpers) comes from the runner.

\echo '--- S01-S09: entitlement Precision access mode (FULL / READ_ONLY / REVOKED) ---'
CREATE FUNCTION pg_temp.premium_project(p_name TEXT) RETURNS UUID AS $$
DECLARE v UUID := pg_temp.new_project(p_name);
BEGIN
  UPDATE project SET premium_ever_activated = true, premium_first_activated_at = now() WHERE project_id = v;
  RETURN v;
END $$ LANGUAGE plpgsql;

DO $t$
DECLARE p UUID := pg_temp.premium_project('Sone'); s UUID; e entitlement%ROWTYPE;
BEGIN
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (p, 'PREMIUM_ACTIVE', now() - interval '10 days', now() + interval '100 days') RETURNING subscription_id INTO s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('S01', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.premium_ended_at IS NULL
    AND e.readonly_until IS NULL AND e.grace_days_applied IS NULL AND e.revoked_at IS NULL, 'a new subscription -> entitlement FULL, every end-of-Premium field empty');

  UPDATE subscription SET status = 'CANCELLATION_SCHEDULED', cancel_at_period_end = true, cancellation_requested_at = now() WHERE subscription_id = s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('S02', e.premium_access_active AND e.precision_access_mode = 'FULL', 'a scheduled cancellation keeps FULL until the period ends');

  UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = now() - interval '1 day' WHERE subscription_id = s;
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('S03', NOT e.premium_access_active AND e.precision_access_mode = 'READ_ONLY' AND e.premium_ended_at = (SELECT ended_at FROM subscription WHERE subscription_id = s)
    AND e.readonly_until IS NULL AND e.revoked_at IS NULL, 'end of Premium -> READ_ONLY from ended_at; the window is settled later from configuration (no day count in SQL)');

  -- the sweep settles the window once; it cannot be rewritten afterwards
  UPDATE entitlement SET grace_days_applied = 90, readonly_until = premium_ended_at + make_interval(days => 90) WHERE project_id = p;
  PERFORM pg_temp.assert_that('S04a', (SELECT readonly_until - premium_ended_at FROM entitlement WHERE project_id = p) = interval '90 days', 'read-only window settled (grace_days_applied snapshot)');
  PERFORM pg_temp.expect_error('S04b', format($q$UPDATE entitlement SET readonly_until = readonly_until + interval '1 day' WHERE project_id = %L$q$, p), 'BV409', 'immutable once settled');
  PERFORM pg_temp.expect_error('S04c', format($q$UPDATE entitlement SET premium_ended_at = premium_ended_at + interval '1 day' WHERE project_id = %L$q$, p), 'BV409', 'immutable once recorded');

  -- READ_ONLY -> REVOKED needs revoked_at (and the settled window)
  PERFORM pg_temp.expect_error('S05a', format($q$UPDATE entitlement SET precision_access_mode = 'REVOKED' WHERE project_id = %L$q$, p), '23514', 'entitlement_revoked_shape');
  UPDATE entitlement SET precision_access_mode = 'REVOKED', revoked_at = now() WHERE project_id = p;
  PERFORM pg_temp.assert_that('S05b', (SELECT precision_access_mode FROM entitlement WHERE project_id = p) = 'REVOKED', 'READ_ONLY -> REVOKED by the sweep; nothing deleted');
  PERFORM pg_temp.assert_that('S05c', (SELECT count(*) FROM subscription WHERE project_id = p) = 1, 'the subscription history is intact');

  -- no way back except a confirmed payment
  PERFORM pg_temp.expect_error('S06a', format($q$UPDATE entitlement SET precision_access_mode = 'READ_ONLY', revoked_at = NULL WHERE project_id = %L$q$, p), 'BV409', 'cannot move from REVOKED to READ_ONLY');
  PERFORM pg_temp.expect_error('S06b', format($q$UPDATE entitlement SET precision_access_mode = 'FULL', premium_ended_at = NULL, readonly_until = NULL, grace_days_applied = NULL, revoked_at = NULL WHERE project_id = %L$q$, p), '23514', 'entitlement_mode_matches_active');

  -- a new confirmed payment on the same project: new subscription -> FULL, all end-of-Premium fields cleared
  INSERT INTO subscription (project_id, status, current_period_start, current_period_end)
    VALUES (p, 'PREMIUM_ACTIVE', now(), now() + interval '365 days');
  SELECT * INTO e FROM entitlement WHERE project_id = p;
  PERFORM pg_temp.assert_that('S07', e.premium_access_active AND e.precision_access_mode = 'FULL' AND e.premium_ended_at IS NULL AND e.readonly_until IS NULL
    AND e.grace_days_applied IS NULL AND e.revoked_at IS NULL, 'automatic return to FULL on a new payment for the same project_id; fields cleared');

  PERFORM pg_temp.expect_error('S08', format($q$DELETE FROM entitlement WHERE project_id = %L$q$, p), 'BV409', 'never deleted');
  PERFORM pg_temp.expect_error('S09a', format($q$UPDATE entitlement SET premium_access_active = false WHERE project_id = %L$q$, p), '23514', 'entitlement_mode_matches_active');
  PERFORM pg_temp.expect_error('S09b', format($q$UPDATE entitlement SET precision_access_mode = 'OWNER' WHERE project_id = %L$q$, p), 'BV409', 'cannot move');
  PERFORM pg_temp.expect_error('S09c', format($q$UPDATE entitlement SET grace_days_applied = 10 WHERE project_id = %L$q$, p), '23514', 'entitlement_full_is_clean');
END $t$;

\echo '--- S10-S15: premium_checkout ---'
DO $t$
DECLARE p UUID := pg_temp.premium_project('Stwo'); q UUID := pg_temp.premium_project('Sthree'); c UUID;
BEGIN
  INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, checkout_url, interface_language, amount_total, currency, expires_at)
    VALUES (p, 'cs_test_s10', 'k10', 'https://checkout.stripe.test/s10', 'es', 49900, 'mxn', now() + interval '1 day') RETURNING checkout_id INTO c;
  PERFORM pg_temp.assert_that('S10', (SELECT status FROM premium_checkout WHERE checkout_id = c) = 'open', 'a checkout starts open');
  PERFORM pg_temp.expect_error('S11a', format($q$INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language) VALUES (%L, 'cs_test_s11', 'k11', 'es')$q$, p), '23505', 'premium_checkout_one_open_per_project');
  PERFORM pg_temp.expect_error('S11b', format($q$INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language) VALUES (%L, 'cs_test_s10', 'k11', 'es')$q$, q), '23505', 'premium_checkout_session_unique');
  PERFORM pg_temp.expect_error('S11c', format($q$INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language, status) VALUES (%L, 'cs_test_s11c', 'k11c', 'es', 'completed')$q$, q), 'BV409', 'always starts open');
  PERFORM pg_temp.expect_error('S11d', format($q$INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language) VALUES (%L, 'cs_test_s11d', 'k11d', 'fr')$q$, q), '23514', 'premium_checkout_language');
  PERFORM pg_temp.expect_error('S11e', format($q$INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language, currency) VALUES (%L, 'cs_test_s11e', 'k11e', 'es', 'MXN')$q$, q), '23514', 'premium_checkout_currency');

  PERFORM pg_temp.expect_error('S12a', format($q$UPDATE premium_checkout SET stripe_session_id = 'cs_other' WHERE checkout_id = %L$q$, c), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S12b', format($q$UPDATE premium_checkout SET project_id = %L WHERE checkout_id = %L$q$, q, c), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S12c', format($q$UPDATE premium_checkout SET amount_total = 1 WHERE checkout_id = %L$q$, c), 'BV409', 'immutable');
  PERFORM pg_temp.expect_error('S12d', format($q$UPDATE premium_checkout SET status = 'completed' WHERE checkout_id = %L$q$, c), '23514', 'premium_checkout_completed_coherent');
  PERFORM pg_temp.expect_error('S12e', format($q$DELETE FROM premium_checkout WHERE checkout_id = %L$q$, c), 'BV409', 'never deleted');

  UPDATE premium_checkout SET status = 'completed', completed_at = now(), outcome = 'ACTIVATED', stripe_payment_intent_id = 'pi_test_s' WHERE checkout_id = c;
  PERFORM pg_temp.assert_that('S13a', (SELECT status FROM premium_checkout WHERE checkout_id = c) = 'completed', 'open -> completed');
  PERFORM pg_temp.expect_error('S13b', format($q$UPDATE premium_checkout SET status = 'open', completed_at = NULL WHERE checkout_id = %L$q$, c), 'BV409', 'cannot move');
  PERFORM pg_temp.expect_error('S13c', format($q$UPDATE premium_checkout SET outcome = 'OTHER' WHERE checkout_id = %L$q$, c), 'BV409', 'write-once');
  PERFORM pg_temp.expect_error('S13d', format($q$UPDATE premium_checkout SET stripe_payment_intent_id = 'pi_other' WHERE checkout_id = %L$q$, c), 'BV409', 'write-once');

  -- a completed checkout frees the project's single "open" slot; expired -> completed is the one allowed back-step
  INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language) VALUES (p, 'cs_test_s14', 'k14', 'en') RETURNING checkout_id INTO c;
  UPDATE premium_checkout SET status = 'expired' WHERE checkout_id = c;
  PERFORM pg_temp.expect_error('S14a', format($q$UPDATE premium_checkout SET status = 'failed' WHERE checkout_id = %L$q$, c), 'BV409', 'cannot move');
  UPDATE premium_checkout SET status = 'completed', completed_at = now(), outcome = 'NOT_APPLICABLE_DUPLICATE_PAYMENT' WHERE checkout_id = c;
  PERFORM pg_temp.assert_that('S14b', (SELECT status FROM premium_checkout WHERE checkout_id = c) = 'completed', 'a payment found after local expiry can still complete');
  INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language) VALUES (p, 'cs_test_s15', 'k15', 'en') RETURNING checkout_id INTO c;
  UPDATE premium_checkout SET status = 'failed' WHERE checkout_id = c;
  PERFORM pg_temp.expect_error('S15', format($q$UPDATE premium_checkout SET status = 'completed', completed_at = now() WHERE checkout_id = %L$q$, c), 'BV409', 'cannot move');

  -- recurring (0031): a LINKED subscription may receive its final outcome exactly once; any other completed outcome stays write-once
  INSERT INTO premium_checkout (project_id, stripe_session_id, idempotency_key, interface_language, billing_mode) VALUES (q, 'cs_test_s15b', 'k15b', 'en', 'subscription') RETURNING checkout_id INTO c;
  UPDATE premium_checkout SET status = 'completed', completed_at = now(), outcome = 'SUBSCRIPTION_LINKED', stripe_subscription_id = 'sub_s15b' WHERE checkout_id = c;
  UPDATE premium_checkout SET outcome = 'ACTIVATED', paid_amount_total = 49900 WHERE checkout_id = c;
  PERFORM pg_temp.assert_that('S15b', (SELECT outcome FROM premium_checkout WHERE checkout_id = c) = 'ACTIVATED', 'a linked subscription gets its final outcome');
  PERFORM pg_temp.expect_error('S15c', format($q$UPDATE premium_checkout SET outcome = 'OTHER' WHERE checkout_id = %L$q$, c), 'BV409', 'write-once');
  PERFORM pg_temp.expect_error('S15d', format($q$UPDATE premium_checkout SET completed_at = now() + interval '1 day' WHERE checkout_id = %L$q$, c), 'BV409', 'write-once');
END $t$;

\echo '--- S16-S19: billing_inbound_event / billing_alert ---'
DO $t$
DECLARE p UUID := pg_temp.premium_project('Sfour'); i UUID; a UUID;
BEGIN
  INSERT INTO billing_inbound_event (stripe_event_id, type, livemode) VALUES ('evt_s16', 'checkout.session.completed', false) RETURNING inbound_id INTO i;
  PERFORM pg_temp.expect_error('S16a', $q$INSERT INTO billing_inbound_event (stripe_event_id, type, livemode) VALUES ('evt_s16', 'x', false)$q$, '23505', 'billing_inbound_event_stripe_event_unique');
  PERFORM pg_temp.expect_error('S16b', format($q$UPDATE billing_inbound_event SET processed_at = now() WHERE inbound_id = %L$q$, i), '23514', 'billing_inbound_event_processed_coherent');
  UPDATE billing_inbound_event SET processed_at = now(), outcome = 'ACTIVATED', project_id = p WHERE inbound_id = i;
  PERFORM pg_temp.expect_error('S17a', format($q$UPDATE billing_inbound_event SET outcome = 'OTHER' WHERE inbound_id = %L$q$, i), 'BV409', 'write-once');
  PERFORM pg_temp.expect_error('S17b', format($q$UPDATE billing_inbound_event SET type = 'other.type' WHERE inbound_id = %L$q$, i), 'BV409', 'identity is immutable');
  PERFORM pg_temp.expect_error('S17c', format($q$DELETE FROM billing_inbound_event WHERE inbound_id = %L$q$, i), 'BV409', 'never deleted');
  UPDATE billing_inbound_event SET attempts = attempts + 1 WHERE inbound_id = i;
  PERFORM pg_temp.assert_that('S17d', (SELECT attempts FROM billing_inbound_event WHERE inbound_id = i) = 2, 'a redelivery may bump the attempt counter');

  INSERT INTO billing_alert (kind, project_id, stripe_ref, detail) VALUES ('duplicate_payment', p, 'cs_test_s18', '{"k":1}') RETURNING alert_id INTO a;
  PERFORM pg_temp.expect_error('S18a', format($q$INSERT INTO billing_alert (kind, project_id, stripe_ref) VALUES ('duplicate_payment', %L, 'cs_test_s18')$q$, p), '23505', 'billing_alert_kind_ref_unique');
  PERFORM pg_temp.expect_error('S18b', $q$INSERT INTO billing_alert (kind) VALUES ('Bad Kind')$q$, '23514', 'billing_alert_kind_format');
  PERFORM pg_temp.expect_error('S18c', format($q$UPDATE billing_alert SET detail = '{}' WHERE alert_id = %L$q$, a), 'BV409', 'immutable except');
  UPDATE billing_alert SET acknowledged_at = now() WHERE alert_id = a;
  PERFORM pg_temp.expect_error('S19a', format($q$UPDATE billing_alert SET acknowledged_at = now() + interval '1 day' WHERE alert_id = %L$q$, a), 'BV409', 'already acknowledged');
  PERFORM pg_temp.expect_error('S19b', format($q$DELETE FROM billing_alert WHERE alert_id = %L$q$, a), 'BV409', 'never deleted');
END $t$;
