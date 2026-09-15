-- Rules + Snapshot (Phases 7–8) — custom SQL migration (drizzle-kit generate --custom).
-- Integrity rules the Drizzle schema DSL cannot express:
--   * every finding is explainable: a rule id, an internal reason, its evidence and signals, and a
--     client reason whenever it is shown (NOT_APPLICABLE is never shown and carries no signal);
--   * findings, priority alignment and capability ranks are written against the project's pinned
--     rules engine and only before the First Assessment is locked (0001 already freezes them after);
--   * the client Snapshot and the Internal Assessment use the pinned versions and are generated
--     together, in the same transaction that locks the First Assessment.

-- =========================================================================
-- finding: explainability contract
-- =========================================================================
ALTER TABLE finding
  ADD CONSTRAINT finding_reason_client_when_shown CHECK (status = 'NOT_APPLICABLE' OR (reason_client IS NOT NULL AND btrim(reason_client) <> '')),
  ADD CONSTRAINT finding_rule_explained CHECK (btrim(rule_triggered) <> '' AND btrim(reason_internal) <> ''),
  ADD CONSTRAINT finding_source_derived_by_rule CHECK (source_type = 'DERIVED_BY_RULE'),
  ADD CONSTRAINT finding_evidence_and_signals_arrays CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_typeof(signals) = 'array'),
  ADD CONSTRAINT finding_not_applicable_without_signal CHECK (status <> 'NOT_APPLICABLE' OR (signal_strength = 'NO_SIGNAL' AND internal_signal IS NULL));

ALTER TABLE capability_rank
  ADD CONSTRAINT capability_rank_factors_object CHECK (jsonb_typeof(ranking_factors) = 'object'),
  ADD CONSTRAINT capability_rank_positive CHECK (rank >= 1);

ALTER TABLE snapshot ADD CONSTRAINT snapshot_content_object CHECK (jsonb_typeof(content) = 'object');
ALTER TABLE internal_assessment ADD CONSTRAINT internal_assessment_content_object CHECK (jsonb_typeof(content) = 'object');

-- =========================================================================
-- Rule outputs: pinned rules engine, never added after the lock
-- =========================================================================
CREATE FUNCTION rule_output_insert_guard() RETURNS TRIGGER AS $$
DECLARE
  v_state assessment_state;
  v_rules TEXT;
BEGIN
  SELECT assessment_state, rules_engine_version INTO v_state, v_rules FROM project WHERE project_id = NEW.project_id;
  IF v_state = 'COMPLETED_LOCKED' THEN
    RAISE EXCEPTION 'project % is COMPLETED_LOCKED; % rows can no longer be added', NEW.project_id, TG_TABLE_NAME
      USING ERRCODE = 'BV409';
  END IF;
  IF NEW.rules_engine_version IS DISTINCT FROM v_rules THEN
    RAISE EXCEPTION '%.rules_engine_version % does not match the project''s pinned version %', TG_TABLE_NAME, NEW.rules_engine_version, v_rules
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_insert_guard BEFORE INSERT ON finding
  FOR EACH ROW EXECUTE FUNCTION rule_output_insert_guard();
CREATE TRIGGER priority_alignment_insert_guard BEFORE INSERT ON priority_alignment
  FOR EACH ROW EXECUTE FUNCTION rule_output_insert_guard();
CREATE TRIGGER capability_rank_insert_guard BEFORE INSERT ON capability_rank
  FOR EACH ROW EXECUTE FUNCTION rule_output_insert_guard();

-- =========================================================================
-- Snapshot + Internal Assessment: pinned versions, generated together with the lock
-- =========================================================================
CREATE FUNCTION assessment_record_insert_guard() RETURNS TRIGGER AS $$
DECLARE
  v_rules TEXT;
  v_template TEXT;
BEGIN
  SELECT rules_engine_version, snapshot_template_version INTO v_rules, v_template FROM project WHERE project_id = NEW.project_id;
  IF NEW.rules_engine_version IS DISTINCT FROM v_rules OR NEW.snapshot_template_version IS DISTINCT FROM v_template THEN
    RAISE EXCEPTION '% for project % must use the pinned versions (rules %, template %)', TG_TABLE_NAME, NEW.project_id, v_rules, v_template
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER snapshot_insert_guard BEFORE INSERT ON snapshot
  FOR EACH ROW EXECUTE FUNCTION assessment_record_insert_guard();
CREATE TRIGGER internal_assessment_insert_guard BEFORE INSERT ON internal_assessment
  FOR EACH ROW EXECUTE FUNCTION assessment_record_insert_guard();

-- Checked at commit: no transaction may leave one record without the other, or a Snapshot for a
-- First Assessment that is not locked.
CREATE FUNCTION assessment_records_generated_together() RETURNS TRIGGER AS $$
DECLARE
  v_state assessment_state;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM snapshot WHERE project_id = NEW.project_id)
     OR NOT EXISTS (SELECT 1 FROM internal_assessment WHERE project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'snapshot and internal_assessment for project % must be generated together', NEW.project_id
      USING ERRCODE = 'BV409';
  END IF;
  SELECT assessment_state INTO v_state FROM project WHERE project_id = NEW.project_id;
  IF v_state IS DISTINCT FROM 'COMPLETED_LOCKED' THEN
    RAISE EXCEPTION 'the Snapshot of project % requires its First Assessment to be COMPLETED_LOCKED', NEW.project_id
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER snapshot_generated_together AFTER INSERT ON snapshot
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_records_generated_together();
CREATE CONSTRAINT TRIGGER internal_assessment_generated_together AFTER INSERT ON internal_assessment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assessment_records_generated_together();
