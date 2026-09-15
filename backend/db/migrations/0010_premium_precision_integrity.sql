-- Phase 9 — Premium transition, Precision handoff and subscription boundary (drizzle-kit generate --custom).
-- Integrity rules the Drizzle schema DSL cannot express (Technical Change Note v1.1 §E–§G,
-- Technical Architecture v1.1 §4.2–§4.3, §8, §10, §11):
--   * entitlement follows the frozen event contract — a scheduled cancellation keeps access until
--     the end of the paid period (corrects the Phase 2 sync trigger, which dropped access at once);
--   * a subscription starts PREMIUM_ACTIVE, only moves forward, and an ended one is never reopened;
--   * subscriptions exist only for projects that entered Premium; first-activation milestones are
--     write-once, and Precision starts only with that first activation;
--   * the Precision handoff package is materialized once, by the project's single premium_activated
--     event, from its own frozen Snapshot and Internal Assessment;
--   * Operation Hub links require active Premium access and are never deleted;
--   * the temporary First Assessment retention candidates never include a project that entered Premium.

-- =========================================================================
-- entitlement: CANCELLATION_SCHEDULED keeps access through current_period_end
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

  INSERT INTO entitlement (project_id, premium_access_active, effective_from, effective_until, updated_at)
  VALUES (
    NEW.project_id,
    NEW.status IN ('PREMIUM_ACTIVE', 'CANCELLATION_SCHEDULED'),
    NEW.current_period_start,
    CASE NEW.status
      WHEN 'PREMIUM_ACTIVE' THEN NULL
      WHEN 'CANCELLATION_SCHEDULED' THEN NEW.current_period_end
      ELSE COALESCE(NEW.ended_at, now())
    END,
    now()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    premium_access_active = EXCLUDED.premium_access_active,
    effective_from = CASE WHEN TG_OP = 'INSERT' THEN EXCLUDED.effective_from ELSE entitlement.effective_from END,
    effective_until = EXCLUDED.effective_until,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- subscription lifecycle: forward-only, never reopened, never deleted
-- =========================================================================
ALTER TABLE subscription ADD CONSTRAINT subscription_period_order CHECK (current_period_end > current_period_start);

CREATE FUNCTION subscription_lifecycle_guard() RETURNS TRIGGER AS $$
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
     OR NEW.created_at <> OLD.created_at OR NEW.current_period_start <> OLD.current_period_start THEN
    RAISE EXCEPTION 'subscription % identity and period start are immutable', OLD.subscription_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'PREMIUM_INACTIVE' THEN
    RAISE EXCEPTION 'subscription % has ended and is never reopened; reactivation creates a new subscription', OLD.subscription_id
      USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PREMIUM_ACTIVE' AND NEW.status IN ('CANCELLATION_SCHEDULED', 'PREMIUM_INACTIVE'))
    OR (OLD.status = 'CANCELLATION_SCHEDULED' AND NEW.status = 'PREMIUM_INACTIVE')) THEN
    RAISE EXCEPTION 'subscription % cannot move from % to %', OLD.subscription_id, OLD.status, NEW.status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'CANCELLATION_SCHEDULED' AND (NOT NEW.cancel_at_period_end OR NEW.cancellation_requested_at IS NULL) THEN
    RAISE EXCEPTION 'a scheduled cancellation records cancel_at_period_end and cancellation_requested_at' USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status = 'PREMIUM_INACTIVE' AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'an ended subscription records ended_at' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_lifecycle_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON subscription
  FOR EACH ROW EXECUTE FUNCTION subscription_lifecycle_guard();

-- Checked at commit: a subscription belongs to a project that entered Premium in the same transaction.
CREATE FUNCTION subscription_requires_premium_project() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project WHERE project_id = NEW.project_id AND premium_ever_activated) THEN
    RAISE EXCEPTION 'project % has a subscription but never entered Premium', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER subscription_requires_premium_project AFTER INSERT ON subscription
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION subscription_requires_premium_project();

-- =========================================================================
-- subscription_event: belongs to its project's subscription; one first activation per project
-- =========================================================================
CREATE FUNCTION subscription_event_insert_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM subscription WHERE subscription_id = NEW.subscription_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'subscription_event for project % references a subscription of another project', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_event_insert_guard_trigger
  BEFORE INSERT ON subscription_event
  FOR EACH ROW EXECUTE FUNCTION subscription_event_insert_guard();

CREATE UNIQUE INDEX subscription_event_one_premium_activated ON subscription_event (project_id) WHERE event_type = 'premium_activated';

-- =========================================================================
-- project: Premium / Precision milestones are write-once and ordered
-- =========================================================================
CREATE FUNCTION project_premium_milestones_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.premium_ever_activated AND NEW.premium_first_activated_at IS NULL THEN
    RAISE EXCEPTION 'project % entered Premium without premium_first_activated_at', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.precision_state = 'STARTED' AND NEW.precision_started_at IS NULL THEN
    RAISE EXCEPTION 'project % started Precision without precision_started_at', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.precision_state = 'STARTED' AND NOT NEW.premium_ever_activated THEN
    RAISE EXCEPTION 'Precision starts only with the first Premium activation (project %)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF (OLD.premium_first_activated_at IS NOT NULL AND NEW.premium_first_activated_at IS DISTINCT FROM OLD.premium_first_activated_at)
     OR (OLD.precision_started_at IS NOT NULL AND NEW.precision_started_at IS DISTINCT FROM OLD.precision_started_at) THEN
    RAISE EXCEPTION 'Premium and Precision milestones of project % are write-once', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_premium_milestones_guard_trigger
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_premium_milestones_guard();

-- =========================================================================
-- precision_handoff_package: once, from the first activation, from frozen records
-- =========================================================================
ALTER TABLE precision_handoff_package ADD CONSTRAINT precision_handoff_package_content_object CHECK (jsonb_typeof(content) = 'object');

CREATE FUNCTION precision_handoff_package_insert_guard() RETURNS TRIGGER AS $$
DECLARE
  v_state assessment_state;
  v_premium BOOLEAN;
  v_precision precision_state;
BEGIN
  SELECT assessment_state, premium_ever_activated, precision_state INTO v_state, v_premium, v_precision
    FROM project WHERE project_id = NEW.project_id;
  IF v_state IS DISTINCT FROM 'COMPLETED_LOCKED' OR v_premium IS NOT TRUE OR v_precision IS DISTINCT FROM 'STARTED' THEN
    RAISE EXCEPTION 'the Precision handoff package of project % is generated only when a locked First Assessment first enters Premium', NEW.project_id
      USING ERRCODE = 'BV409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM snapshot WHERE snapshot_id = NEW.source_snapshot_id AND project_id = NEW.project_id)
     OR NOT EXISTS (SELECT 1 FROM internal_assessment WHERE internal_assessment_id = NEW.source_internal_assessment_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the Precision handoff package of project % must come from its own frozen Snapshot and Internal Assessment', NEW.project_id
      USING ERRCODE = 'BV409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM subscription_event WHERE event_id = NEW.generated_by_event_id AND project_id = NEW.project_id AND event_type = 'premium_activated') THEN
    RAISE EXCEPTION 'the Precision handoff package of project % must be generated by its premium_activated event', NEW.project_id
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER precision_handoff_package_insert_guard_trigger
  BEFORE INSERT ON precision_handoff_package
  FOR EACH ROW EXECUTE FUNCTION precision_handoff_package_insert_guard();

-- =========================================================================
-- operation_hub_link: created while Premium access is active, never deleted
-- =========================================================================
CREATE FUNCTION operation_hub_link_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operation_hub_link rows are never deleted; access follows entitlement' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM entitlement WHERE project_id = NEW.project_id AND premium_access_active) THEN
    RAISE EXCEPTION 'an Operation Hub link for project % requires active Premium access', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.project_id <> OLD.project_id OR NEW.external_system <> OLD.external_system) THEN
    RAISE EXCEPTION 'operation_hub_link identity is immutable' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER operation_hub_link_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON operation_hub_link
  FOR EACH ROW EXECUTE FUNCTION operation_hub_link_guard();

-- =========================================================================
-- premium_activation_request: an intent with Terms acceptance, fulfilled only by an activation event
-- =========================================================================
ALTER TABLE premium_activation_request
  ADD CONSTRAINT premium_activation_request_kind CHECK (kind IN ('activation', 'reactivation')),
  ADD CONSTRAINT premium_activation_request_status CHECK (status IN ('REQUESTED', 'FULFILLED')),
  ADD CONSTRAINT premium_activation_request_fulfilment CHECK ((status = 'FULFILLED') = (fulfilled_at IS NOT NULL AND fulfilled_by_event_id IS NOT NULL)),
  ADD CONSTRAINT premium_activation_request_language CHECK (interface_language IN ('en', 'es'));

CREATE FUNCTION premium_activation_request_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'premium_activation_request rows are never deleted' USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM project WHERE project_id = NEW.project_id AND assessment_state = 'COMPLETED_LOCKED') THEN
      RAISE EXCEPTION 'Premium can be requested only after the First Assessment is complete (project %)', NEW.project_id USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.project_id <> OLD.project_id OR NEW.person_id <> OLD.person_id OR NEW.kind <> OLD.kind
     OR NEW.terms_url <> OLD.terms_url OR NEW.terms_accepted_at <> OLD.terms_accepted_at OR NEW.requested_at <> OLD.requested_at
     OR NEW.checkout_adapter <> OLD.checkout_adapter OR NEW.interface_language <> OLD.interface_language
     OR (OLD.checkout_reference IS NOT NULL AND NEW.checkout_reference IS DISTINCT FROM OLD.checkout_reference) THEN
    RAISE EXCEPTION 'premium_activation_request % is immutable except its checkout reference and fulfilment', OLD.request_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'FULFILLED' AND (NEW.status <> 'FULFILLED' OR NEW.fulfilled_at IS DISTINCT FROM OLD.fulfilled_at OR NEW.fulfilled_by_event_id IS DISTINCT FROM OLD.fulfilled_by_event_id) THEN
    RAISE EXCEPTION 'premium_activation_request % is already fulfilled', OLD.request_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER premium_activation_request_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON premium_activation_request
  FOR EACH ROW EXECUTE FUNCTION premium_activation_request_guard();

-- =========================================================================
-- Temporary First Assessment retention: Premium always wins (the Phase 11 job reads only this)
-- =========================================================================
CREATE FUNCTION fa_temporary_retention_candidates(p_now TIMESTAMPTZ) RETURNS TABLE (project_id UUID) AS $$
BEGIN
  -- Locks each candidate with the same project row lock the Premium activation handler takes; a
  -- project whose activation is in flight is skipped, and once committed it is excluded forever.
  RETURN QUERY
    SELECT p.project_id
      FROM project p
      JOIN fa_project_lifecycle l ON l.project_id = p.project_id
     WHERE p.assessment_state IN ('IN_PROGRESS', 'COMPLETED_LOCKED')
       AND NOT p.premium_ever_activated
       AND l.retention_until IS NOT NULL
       AND l.retention_until <= p_now
     ORDER BY p.project_id
     FOR UPDATE OF p SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;
