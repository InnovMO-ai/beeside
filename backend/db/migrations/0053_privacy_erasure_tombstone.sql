-- PRIVACY ERASURE TOMBSTONE (finding F2 of the clone rehearsal review; Product Owner decision 2026-10-17).
--
-- A personal-data erasure (fa4_anonymize_project) must stay effective for the whole transition between the legacy `discovery` database and the canonical `beeside` database, also after a
-- rollback. The data tools (domain-data-sync, domain-erasure-reconcile) refuse to run while the two sides disagree about an erasure; this migration is the DATABASE-LEVEL BACKSTOP behind them:
-- once a project is ANONYMIZED, no statement of any role (the application runtimes, the sync, an operator) can write personal data back into it.
--   * fa4_project: an ANONYMIZED row cannot change its e-mail, its answers or its status; a row cannot be inserted as ANONYMIZED carrying anything but the scrubbed values.
--   * fa4_result / fa4_demand_signal / fa4_contact_request: a row that belongs to an ANONYMIZED project can only be inserted or updated in its scrubbed form
--     (exactly what fa4_anonymize_project writes).
-- Legitimate erasure is unaffected: fa4_anonymize_project writes the scrubbed form, the project row is flipped to ANONYMIZED last, and running it again writes the same values.
-- Error code BV607. Nothing here deletes or changes data. Rollback: DROP TRIGGER fa4_tombstone_* ...; DROP FUNCTION fa4_erased_project_guard() (also infra/db/legacy/legacy-erasure-guard-rollback.sql). The same SQL can be applied, optionally and reversibly, to the legacy database (runbook, "legacy protection").
-- The triggers are named fa4_tombstone_* so that they fire AFTER the existing guards (fa4_result_append_only, fa4_project_delivered_lock): every error code an existing contract returns stays the same
-- (BV601 append-only, BV604 delivered project); BV607 is what remains when nothing else already refused the write.
-- Limit (documented): a concurrent insert that commits before the erasure commits is not seen by this guard; the reconciliation tool detects such residue (it compares every erased project with the scrubbed form).
CREATE FUNCTION fa4_erased_project_guard() RETURNS TRIGGER AS $$
DECLARE
  v_scrubbed boolean;
BEGIN
  IF TG_TABLE_NAME = 'fa4_project' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'ANONYMIZED'
       AND (NEW.status IS DISTINCT FROM 'ANONYMIZED' OR NEW.email IS DISTINCT FROM OLD.email OR NEW.answers IS DISTINCT FROM OLD.answers) THEN
      RAISE EXCEPTION 'fa4_project %: an erased project cannot receive personal data again', OLD.project_id USING ERRCODE = 'BV607';
    END IF;
    IF NEW.status = 'ANONYMIZED'
       AND (NEW.email IS DISTINCT FROM 'anonymized+' || NEW.project_id::text || '@invalid.invalid' OR NEW.answers IS DISTINCT FROM '{}'::jsonb) THEN
      RAISE EXCEPTION 'fa4_project %: an ANONYMIZED project must carry the scrubbed values only', NEW.project_id USING ERRCODE = 'BV607';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM fa4_project p WHERE p.project_id = NEW.project_id AND p.status = 'ANONYMIZED') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'fa4_result' THEN
    v_scrubbed := NEW.model = '{"anonymized": true}'::jsonb
                  AND (NEW.source_snapshot IS NULL OR NEW.source_snapshot = '{"anonymized": true}'::jsonb)
                  AND (NEW.resolution_snapshot IS NULL OR NEW.resolution_snapshot = '{"anonymized": true}'::jsonb);
  ELSIF TG_TABLE_NAME = 'fa4_demand_signal' THEN
    v_scrubbed := NEW.payload = '{"anonymized": true}'::jsonb;
  ELSIF TG_TABLE_NAME = 'fa4_contact_request' THEN
    v_scrubbed := NEW.name = 'anonymized' AND NEW.company = 'anonymized' AND NEW.message = 'anonymized'
                  AND NEW.email = 'anonymized+' || NEW.contact_id::text || '@invalid.invalid';
  ELSE
    v_scrubbed := true;
  END IF;
  IF NOT coalesce(v_scrubbed, false) THEN
    RAISE EXCEPTION '%: project % was erased, only the scrubbed form can be stored', TG_TABLE_NAME, NEW.project_id USING ERRCODE = 'BV607';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER fa4_tombstone_project BEFORE INSERT OR UPDATE ON fa4_project
  FOR EACH ROW EXECUTE FUNCTION fa4_erased_project_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_tombstone_result BEFORE INSERT OR UPDATE ON fa4_result
  FOR EACH ROW EXECUTE FUNCTION fa4_erased_project_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_tombstone_signal BEFORE INSERT OR UPDATE ON fa4_demand_signal
  FOR EACH ROW EXECUTE FUNCTION fa4_erased_project_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_tombstone_contact BEFORE INSERT OR UPDATE ON fa4_contact_request
  FOR EACH ROW EXECUTE FUNCTION fa4_erased_project_guard();
