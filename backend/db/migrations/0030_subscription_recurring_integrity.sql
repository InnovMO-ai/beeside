-- Recurring billing integrity (provider-agnostic). A subscription row means "money was collected for this term".
--   * the paid-through date (current_period_end) only moves FORWARD (a renewal), never back, and an ended row never changes;
--   * a scheduled cancellation may be withdrawn (CANCELLATION_SCHEDULED -> PREMIUM_ACTIVE), restoring renewal; the cancellation
--     fields are cleared and the state-transition ledger keeps the history;
--   * auto_renews is a fact about how the subscription was created and is immutable.
-- Rollback: restore the 0010 body of subscription_lifecycle_guard() (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION subscription_lifecycle_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription rows are never deleted (subscription %)', OLD.subscription_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREMIUM_ACTIVE' OR NEW.cancel_at_period_end OR NEW.cancellation_requested_at IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'a subscription always starts as PREMIUM_ACTIVE' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.subscription_id <> OLD.subscription_id OR NEW.project_id <> OLD.project_id
     OR NEW.created_at <> OLD.created_at OR NEW.current_period_start <> OLD.current_period_start OR NEW.auto_renews <> OLD.auto_renews THEN
    RAISE EXCEPTION 'subscription % identity, period start and renewal mode are immutable', OLD.subscription_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'PREMIUM_INACTIVE' THEN
    RAISE EXCEPTION 'subscription % has ended and is never reopened; reactivation creates a new subscription', OLD.subscription_id
      USING ERRCODE = 'BV409';
  END IF;
  IF NEW.current_period_end < OLD.current_period_end THEN
    RAISE EXCEPTION 'subscription % paid-through date only moves forward', OLD.subscription_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PREMIUM_ACTIVE' AND NEW.status IN ('CANCELLATION_SCHEDULED', 'PREMIUM_INACTIVE'))
    OR (OLD.status = 'CANCELLATION_SCHEDULED' AND NEW.status IN ('PREMIUM_INACTIVE', 'PREMIUM_ACTIVE'))) THEN
    RAISE EXCEPTION 'subscription % cannot move from % to %', OLD.subscription_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'CANCELLATION_SCHEDULED' AND (NOT NEW.cancel_at_period_end OR NEW.cancellation_requested_at IS NULL) THEN
    RAISE EXCEPTION 'a scheduled cancellation records cancel_at_period_end and cancellation_requested_at' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'PREMIUM_ACTIVE' AND (NEW.cancel_at_period_end OR NEW.cancellation_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an active subscription carries no scheduled cancellation (withdrawing it clears the fields)' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'PREMIUM_INACTIVE' AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'an ended subscription records ended_at' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
