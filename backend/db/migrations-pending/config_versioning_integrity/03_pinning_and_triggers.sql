
-- =========================================================================
-- Version pinning at assessment_started (= the project INSERT, Build Plan Phase 4 handler).
-- The three version columns are resolved from the current PUBLISHED versions inside the same
-- statement; an explicit value is accepted only if it IS the current version. After insert,
-- project_guard (0001) keeps them immutable for the life of the project, so a later publish or
-- rollback repoint can never change what an in-flight or completed project uses.
-- =========================================================================
CREATE FUNCTION project_pin_current_versions() RETURNS TRIGGER AS $$
DECLARE
  v_question_bank TEXT;
  v_rules_engine TEXT;
  v_snapshot_template TEXT;
BEGIN
  SELECT version INTO v_question_bank FROM question_bank_version WHERE is_current;
  SELECT version INTO v_rules_engine FROM rules_engine_version WHERE is_current;
  SELECT version INTO v_snapshot_template FROM snapshot_template_version WHERE is_current;
  IF v_question_bank IS NULL OR v_rules_engine IS NULL OR v_snapshot_template IS NULL THEN
    RAISE EXCEPTION 'assessment_started refused: every registry needs a current PUBLISHED version (question_bank=%, rules_engine=%, snapshot_template=%)',
      v_question_bank, v_rules_engine, v_snapshot_template USING ERRCODE = 'BV412';
  END IF;

  IF NEW.question_bank_version IS NULL THEN
    NEW.question_bank_version := v_question_bank;
  ELSIF NEW.question_bank_version <> v_question_bank THEN
    RAISE EXCEPTION 'assessment_started must pin the current question_bank_version % (got %)',
      v_question_bank, NEW.question_bank_version USING ERRCODE = 'BV412';
  END IF;
  IF NEW.rules_engine_version IS NULL THEN
    NEW.rules_engine_version := v_rules_engine;
  ELSIF NEW.rules_engine_version <> v_rules_engine THEN
    RAISE EXCEPTION 'assessment_started must pin the current rules_engine_version % (got %)',
      v_rules_engine, NEW.rules_engine_version USING ERRCODE = 'BV412';
  END IF;
  IF NEW.snapshot_template_version IS NULL THEN
    NEW.snapshot_template_version := v_snapshot_template;
  ELSIF NEW.snapshot_template_version <> v_snapshot_template THEN
    RAISE EXCEPTION 'assessment_started must pin the current snapshot_template_version % (got %)',
      v_snapshot_template, NEW.snapshot_template_version USING ERRCODE = 'BV412';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_pin_current_versions_trigger
  BEFORE INSERT ON project
  FOR EACH ROW EXECUTE FUNCTION project_pin_current_versions();

-- =========================================================================
-- Trigger wiring
-- =========================================================================
CREATE TRIGGER question_bank_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON question_bank_version
  FOR EACH ROW EXECUTE FUNCTION config_version_guard();

CREATE TRIGGER rules_engine_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON rules_engine_version
  FOR EACH ROW EXECUTE FUNCTION config_version_guard();

CREATE TRIGGER snapshot_template_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON snapshot_template_version
  FOR EACH ROW EXECUTE FUNCTION config_version_guard();

CREATE TRIGGER config_version_review_insert_guard
  BEFORE INSERT ON config_version_review
  FOR EACH ROW EXECUTE FUNCTION config_audit_insert_guard();

CREATE TRIGGER config_version_review_append_only
  BEFORE UPDATE OR DELETE ON config_version_review
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

CREATE TRIGGER config_version_event_insert_guard
  BEFORE INSERT ON config_version_event
  FOR EACH ROW EXECUTE FUNCTION config_audit_insert_guard();

CREATE TRIGGER config_version_event_append_only
  BEFORE UPDATE OR DELETE ON config_version_event
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();
