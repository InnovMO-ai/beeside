-- F5 Track C — oh_delivery attempt integrity (follows 0021).
-- Rules the Drizzle DSL cannot express:
--   * a terminal row (delivered | failed) must close an existing queued row of the SAME key AND attempt
--     (the ledger records "queued -> outcome" pairs; an outcome without a queued row is never legitimate);
--   * the application role keeps INSERT/SELECT only (UPDATE already revoked in 0020; DELETE is blocked by the trigger).
-- Retrying a failed delivery of the same key writes a new queued row with attempt = previous + 1.

CREATE OR REPLACE FUNCTION oh_delivery_guard() RETURNS TRIGGER AS $$
DECLARE v_owner UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'oh_delivery rows are append-only (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.pack_id IS NOT NULL THEN
    SELECT ca.project_id INTO v_owner FROM pack p JOIN category_assessment ca ON ca.instance_id = p.category_assessment_instance_id WHERE p.id = NEW.pack_id;
  ELSE
    SELECT pi.project_id INTO v_owner FROM service_map_snapshot s JOIN precision_instance pi ON pi.id = s.precision_instance_id WHERE s.id = NEW.snapshot_id;
  END IF;
  IF v_owner IS NULL OR v_owner <> NEW.project_id THEN
    RAISE EXCEPTION 'oh_delivery artifact does not belong to project % (cross-project scoping violation)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.status IN ('delivered', 'failed') AND NOT EXISTS (
    SELECT 1 FROM oh_delivery q WHERE q.idempotency_key = NEW.idempotency_key AND q.status = 'queued' AND q.attempt = NEW.attempt
  ) THEN
    RAISE EXCEPTION 'oh_delivery % row for key % attempt % has no matching queued row', NEW.status, NEW.idempotency_key, NEW.attempt USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- The current-state view also exposes the attempt (appended last: CREATE OR REPLACE VIEW may only add trailing columns).
CREATE OR REPLACE VIEW oh_delivery_current AS
  SELECT DISTINCT ON (idempotency_key) * FROM oh_delivery ORDER BY idempotency_key, seq DESC;
