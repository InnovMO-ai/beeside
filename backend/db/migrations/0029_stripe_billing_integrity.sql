-- F5 Track B (Stripe) — integrity rules the Drizzle DSL cannot express (follows 0021, drizzle-kit generate --custom).
--
-- What this migration does:
--   1. entitlement.precision_access_mode (FULL | READ_ONLY | REVOKED): backfills the rows that existed before
--      0021 and adds the coherence CHECKs (Core-owned state, contract §G).
--   2. Replaces the subscription -> entitlement sync trigger function (0010) so the SAME statement that grants or
--      ends Premium access also moves the Precision access mode: active -> FULL (and clears every end-of-Premium
--      field: automatic return to FULL on a new confirmed payment for the same project_id); active -> ended ->
--      READ_ONLY with premium_ended_at. readonly_until / grace_days_applied are settled by the Core sweep from a
--      CONFIGURABLE window (no day count is hard-coded here); READ_ONLY -> REVOKED is done by the sweep only.
--   3. Guards: entitlement rows are never deleted and only move FULL -> READ_ONLY -> REVOKED, or back to FULL;
--      premium_checkout status moves forward only and its identity/snapshot columns are immutable;
--      billing_inbound_event / billing_alert are append-only (outcome and acknowledgement are write-once).
--
-- Revert (manual; run in one transaction, newest first). Data in the three new tables is lost on DROP:
--   BEGIN;
--   DROP TRIGGER IF EXISTS billing_alert_guard_trigger ON billing_alert;
--   DROP FUNCTION IF EXISTS billing_alert_guard();
--   DROP TRIGGER IF EXISTS billing_inbound_event_guard_trigger ON billing_inbound_event;
--   DROP FUNCTION IF EXISTS billing_inbound_event_guard();
--   DROP TRIGGER IF EXISTS premium_checkout_guard_trigger ON premium_checkout;
--   DROP FUNCTION IF EXISTS premium_checkout_guard();
--   DROP TRIGGER IF EXISTS entitlement_precision_access_guard_trigger ON entitlement;
--   DROP FUNCTION IF EXISTS entitlement_precision_access_guard();
--   -- restore the 0010 body of subscription_sync_entitlement_and_history() (CREATE OR REPLACE from 0010), then:
--   ALTER TABLE entitlement DROP CONSTRAINT IF EXISTS entitlement_precision_access_mode_valid, DROP CONSTRAINT IF EXISTS entitlement_mode_matches_active,
--     DROP CONSTRAINT IF EXISTS entitlement_full_is_clean, DROP CONSTRAINT IF EXISTS entitlement_read_only_shape,
--     DROP CONSTRAINT IF EXISTS entitlement_revoked_shape, DROP CONSTRAINT IF EXISTS entitlement_window_after_end,
--     DROP CONSTRAINT IF EXISTS entitlement_grace_days_nonnegative;
--   DROP TABLE billing_alert, billing_inbound_event, premium_checkout;
--   ALTER TABLE entitlement DROP COLUMN precision_access_mode, DROP COLUMN premium_ended_at, DROP COLUMN readonly_until,
--     DROP COLUMN grace_days_applied, DROP COLUMN revoked_at;
--   DELETE FROM drizzle.__drizzle_migrations WHERE id IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 2);
--   COMMIT;

-- =========================================================================
-- 1. entitlement: backfill, then coherence CHECKs
-- =========================================================================
UPDATE entitlement SET
  precision_access_mode = CASE WHEN premium_access_active THEN 'FULL' ELSE 'READ_ONLY' END,
  premium_ended_at = CASE WHEN premium_access_active THEN NULL ELSE COALESCE(effective_until, updated_at) END;--> statement-breakpoint

ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_precision_access_mode_valid"
  CHECK (precision_access_mode IN ('FULL', 'READ_ONLY', 'REVOKED'));--> statement-breakpoint
-- Premium access active <=> Precision access FULL. Precision can never be FULL without a paid, current Premium.
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_mode_matches_active"
  CHECK (premium_access_active = (precision_access_mode = 'FULL'));--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_full_is_clean"
  CHECK (precision_access_mode <> 'FULL' OR (premium_ended_at IS NULL AND readonly_until IS NULL AND revoked_at IS NULL AND grace_days_applied IS NULL));--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_read_only_shape"
  CHECK (precision_access_mode <> 'READ_ONLY' OR (premium_ended_at IS NOT NULL AND revoked_at IS NULL));--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_revoked_shape"
  CHECK (precision_access_mode <> 'REVOKED' OR (premium_ended_at IS NOT NULL AND readonly_until IS NOT NULL AND revoked_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_window_after_end"
  CHECK (readonly_until IS NULL OR (premium_ended_at IS NOT NULL AND readonly_until >= premium_ended_at));--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_grace_days_nonnegative"
  CHECK (grace_days_applied IS NULL OR grace_days_applied >= 0);--> statement-breakpoint

-- =========================================================================
-- 2. subscription -> entitlement sync (replaces the 0010 body; adds the Precision access mode)
-- =========================================================================
CREATE OR REPLACE FUNCTION subscription_sync_entitlement_and_history() RETURNS TRIGGER AS $$
DECLARE
  v_active BOOLEAN := NEW.status IN ('PREMIUM_ACTIVE', 'CANCELLATION_SCHEDULED');
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

  INSERT INTO entitlement (project_id, premium_access_active, effective_from, effective_until, updated_at,
                           precision_access_mode, premium_ended_at, readonly_until, grace_days_applied, revoked_at)
  VALUES (
    NEW.project_id,
    v_active,
    NEW.current_period_start,
    CASE NEW.status
      WHEN 'PREMIUM_ACTIVE' THEN NULL
      WHEN 'CANCELLATION_SCHEDULED' THEN NEW.current_period_end
      ELSE COALESCE(NEW.ended_at, now())
    END,
    now(),
    CASE WHEN v_active THEN 'FULL' ELSE 'READ_ONLY' END,
    CASE WHEN v_active THEN NULL ELSE COALESCE(NEW.ended_at, now()) END,
    NULL, NULL, NULL
  )
  ON CONFLICT (project_id) DO UPDATE SET
    premium_access_active = EXCLUDED.premium_access_active,
    effective_from = CASE WHEN TG_OP = 'INSERT' THEN EXCLUDED.effective_from ELSE entitlement.effective_from END,
    effective_until = EXCLUDED.effective_until,
    updated_at = now(),
    -- active (now or newly) => FULL with every end-of-Premium field cleared (automatic return to FULL on payment);
    -- active -> ended => READ_ONLY from the end of Premium; ended -> ended keeps the state the sweep reached.
    precision_access_mode = CASE
      WHEN EXCLUDED.premium_access_active THEN 'FULL'
      WHEN entitlement.premium_access_active THEN 'READ_ONLY'
      ELSE entitlement.precision_access_mode END,
    premium_ended_at = CASE
      WHEN EXCLUDED.premium_access_active THEN NULL
      WHEN entitlement.premium_access_active THEN EXCLUDED.premium_ended_at
      ELSE entitlement.premium_ended_at END,
    readonly_until = CASE WHEN EXCLUDED.premium_access_active OR entitlement.premium_access_active THEN NULL ELSE entitlement.readonly_until END,
    grace_days_applied = CASE WHEN EXCLUDED.premium_access_active OR entitlement.premium_access_active THEN NULL ELSE entitlement.grace_days_applied END,
    revoked_at = CASE WHEN EXCLUDED.premium_access_active OR entitlement.premium_access_active THEN NULL ELSE entitlement.revoked_at END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- =========================================================================
-- 3a. entitlement guard: never deleted; mode moves FULL -> READ_ONLY -> REVOKED or back to FULL only
-- =========================================================================
CREATE FUNCTION entitlement_precision_access_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entitlement rows are never deleted (project %)', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'entitlement.project_id is immutable' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.precision_access_mode <> OLD.precision_access_mode AND NOT (
       NEW.precision_access_mode = 'FULL'
    OR (OLD.precision_access_mode = 'FULL' AND NEW.precision_access_mode = 'READ_ONLY')
    OR (OLD.precision_access_mode = 'READ_ONLY' AND NEW.precision_access_mode = 'REVOKED')) THEN
    RAISE EXCEPTION 'entitlement % cannot move from % to %', OLD.project_id, OLD.precision_access_mode, NEW.precision_access_mode USING ERRCODE = 'BV409';
  END IF;
  IF OLD.precision_access_mode <> 'FULL' AND NEW.precision_access_mode = OLD.precision_access_mode THEN
    IF NEW.premium_ended_at IS DISTINCT FROM OLD.premium_ended_at THEN
      RAISE EXCEPTION 'entitlement % end of Premium is immutable once recorded', OLD.project_id USING ERRCODE = 'BV409';
    END IF;
    IF OLD.readonly_until IS NOT NULL AND (NEW.readonly_until IS DISTINCT FROM OLD.readonly_until OR NEW.grace_days_applied IS DISTINCT FROM OLD.grace_days_applied) THEN
      RAISE EXCEPTION 'entitlement % read-only window is immutable once settled', OLD.project_id USING ERRCODE = 'BV409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER entitlement_precision_access_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON entitlement
  FOR EACH ROW EXECUTE FUNCTION entitlement_precision_access_guard();--> statement-breakpoint

-- =========================================================================
-- 3b. premium_checkout guard: forward-only status, immutable identity and Stripe snapshot, never deleted.
-- 'expired' may still become 'completed': a local/Stripe expiry guess must never block a payment that really happened.
-- =========================================================================
CREATE FUNCTION premium_checkout_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'premium_checkout rows are never deleted (%)', OLD.checkout_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.completed_at IS NOT NULL OR NEW.outcome IS NOT NULL THEN
      RAISE EXCEPTION 'a premium_checkout always starts open' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.checkout_id, NEW.project_id, NEW.request_id, NEW.stripe_session_id, NEW.idempotency_key, NEW.checkout_url,
      NEW.interface_language, NEW.amount_total, NEW.currency, NEW.created_at)
     IS DISTINCT FROM
     (OLD.checkout_id, OLD.project_id, OLD.request_id, OLD.stripe_session_id, OLD.idempotency_key, OLD.checkout_url,
      OLD.interface_language, OLD.amount_total, OLD.currency, OLD.created_at) THEN
    RAISE EXCEPTION 'premium_checkout % identity and Stripe snapshot are immutable', OLD.checkout_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('completed', 'expired', 'failed'))
    OR (OLD.status = 'expired' AND NEW.status = 'completed')) THEN
    RAISE EXCEPTION 'premium_checkout % cannot move from % to %', OLD.checkout_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'completed' AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.paid_amount_total IS DISTINCT FROM OLD.paid_amount_total) THEN
    RAISE EXCEPTION 'premium_checkout % is completed; its outcome is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'premium_checkout % payment intent is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER premium_checkout_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON premium_checkout
  FOR EACH ROW EXECUTE FUNCTION premium_checkout_guard();--> statement-breakpoint

-- =========================================================================
-- 3c. billing_inbound_event: append-only audit; the processing result is write-once
-- =========================================================================
CREATE FUNCTION billing_inbound_event_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing_inbound_event rows are never deleted (%)', OLD.stripe_event_id USING ERRCODE = 'BV409';
  END IF;
  IF (NEW.inbound_id, NEW.stripe_event_id, NEW.type, NEW.livemode, NEW.received_at)
     IS DISTINCT FROM (OLD.inbound_id, OLD.stripe_event_id, OLD.type, OLD.livemode, OLD.received_at) THEN
    RAISE EXCEPTION 'billing_inbound_event % identity is immutable', OLD.stripe_event_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.processed_at IS NOT NULL AND (NEW.processed_at IS DISTINCT FROM OLD.processed_at OR NEW.outcome IS DISTINCT FROM OLD.outcome) THEN
    RAISE EXCEPTION 'billing_inbound_event % was processed; its outcome is write-once', OLD.stripe_event_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER billing_inbound_event_guard_trigger BEFORE UPDATE OR DELETE ON billing_inbound_event
  FOR EACH ROW EXECUTE FUNCTION billing_inbound_event_guard();--> statement-breakpoint

-- =========================================================================
-- 3d. billing_alert: never deleted; only the acknowledgement can be set, once
-- =========================================================================
CREATE FUNCTION billing_alert_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing_alert rows are never deleted (%)', OLD.alert_id USING ERRCODE = 'BV409';
  END IF;
  IF (NEW.alert_id, NEW.kind, NEW.project_id, NEW.stripe_ref, NEW.detail, NEW.created_at)
     IS DISTINCT FROM (OLD.alert_id, OLD.kind, OLD.project_id, OLD.stripe_ref, OLD.detail, OLD.created_at) THEN
    RAISE EXCEPTION 'billing_alert % is immutable except for its acknowledgement', OLD.alert_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    RAISE EXCEPTION 'billing_alert % was already acknowledged', OLD.alert_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER billing_alert_guard_trigger BEFORE UPDATE OR DELETE ON billing_alert
  FOR EACH ROW EXECUTE FUNCTION billing_alert_guard();
