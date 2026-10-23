-- Recurring billing: a completed Checkout session proves only that the Stripe subscription EXISTS (outcome 'SUBSCRIPTION_LINKED'); the
-- money arrives later (first invoice, possibly after a free-access trial). That provisional outcome may be replaced ONCE by the final
-- one (and the paid amount filled once). Every other completed row stays write-once exactly as before (0022).
-- Rollback: restore the 0022 body of premium_checkout_guard() (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION premium_checkout_guard() RETURNS TRIGGER AS $$
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
  IF OLD.status = 'completed' THEN
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'premium_checkout % is completed; its outcome is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
    END IF;
    -- The one allowed refinement: a subscription that was only LINKED gets its final outcome (and paid amount) once.
    IF OLD.outcome IS DISTINCT FROM 'SUBSCRIPTION_LINKED' AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.paid_amount_total IS DISTINCT FROM OLD.paid_amount_total) THEN
      RAISE EXCEPTION 'premium_checkout % is completed; its outcome is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
    END IF;
    IF OLD.outcome = 'SUBSCRIPTION_LINKED' AND OLD.paid_amount_total IS NOT NULL AND NEW.paid_amount_total IS DISTINCT FROM OLD.paid_amount_total THEN
      RAISE EXCEPTION 'premium_checkout % is completed; its outcome is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
    END IF;
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'premium_checkout % payment intent is write-once', OLD.checkout_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
