-- F5 Track A — integrity rules for the product-surface tables (follows 0025).

CREATE FUNCTION precision_append_only_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER precision_turn_append_only BEFORE UPDATE OR DELETE ON precision_turn
  FOR EACH ROW EXECUTE FUNCTION precision_append_only_guard();--> statement-breakpoint
CREATE TRIGGER precision_journey_event_append_only BEFORE UPDATE OR DELETE ON precision_journey_event
  FOR EACH ROW EXECUTE FUNCTION precision_append_only_guard();--> statement-breakpoint
CREATE TRIGGER crp_confirmation_append_only BEFORE UPDATE OR DELETE ON crp_confirmation
  FOR EACH ROW EXECUTE FUNCTION precision_append_only_guard();--> statement-breakpoint

-- A turn must belong to a precision_instance of the declared project.
CREATE FUNCTION precision_turn_guard() RETURNS TRIGGER AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT project_id INTO v_owner FROM precision_instance WHERE id = NEW.scope_instance_id;
  IF v_owner IS NULL OR v_owner <> NEW.project_id THEN
    RAISE EXCEPTION 'precision_turn scope does not belong to project % (cross-project scoping violation)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER precision_turn_guard_trigger BEFORE INSERT ON precision_turn
  FOR EACH ROW EXECUTE FUNCTION precision_turn_guard();--> statement-breakpoint

-- A confirmation must belong to a pack of the declared project.
CREATE FUNCTION crp_confirmation_guard() RETURNS TRIGGER AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT ca.project_id INTO v_owner FROM pack p JOIN category_assessment ca ON ca.instance_id = p.category_assessment_instance_id WHERE p.id = NEW.pack_id;
  IF v_owner IS NULL OR v_owner <> NEW.project_id THEN
    RAISE EXCEPTION 'crp_confirmation pack does not belong to project % (cross-project scoping violation)', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER crp_confirmation_guard_trigger BEFORE INSERT ON crp_confirmation
  FOR EACH ROW EXECUTE FUNCTION crp_confirmation_guard();--> statement-breakpoint

-- Access tokens: only consumption/revocation may change; the hash and scope are immutable and rows are never deleted.
CREATE FUNCTION precision_access_token_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'precision_access_token rows are never deleted' USING ERRCODE = 'BV409'; END IF;
  IF (NEW.id, NEW.token_hash, NEW.project_id, NEW.kind, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.token_hash, OLD.project_id, OLD.kind, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'precision_access_token % is immutable except consumed_at/revoked_at', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'precision_access_token % is already consumed', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER precision_access_token_guard_trigger BEFORE UPDATE OR DELETE ON precision_access_token
  FOR EACH ROW EXECUTE FUNCTION precision_access_token_guard();--> statement-breakpoint

REVOKE UPDATE ON "precision_turn" FROM beeside_runtime_role;--> statement-breakpoint
REVOKE UPDATE ON "precision_journey_event" FROM beeside_runtime_role;--> statement-breakpoint
REVOKE UPDATE ON "crp_confirmation" FROM beeside_runtime_role;--> statement-breakpoint
REVOKE UPDATE ON "precision_access_token" FROM beeside_runtime_role;--> statement-breakpoint
GRANT UPDATE ("consumed_at", "revoked_at") ON "precision_access_token" TO beeside_runtime_role;
