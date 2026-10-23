-- Macroblock 4 — Precision persistence integrity rules the Drizzle schema DSL cannot express
-- (drizzle-kit generate --custom), mirroring this repo's existing hand-written integrity-migration
-- pattern (0001, 0004, 0006, 0008, 0010, 0012, 0014). Canonical shapes: precision-block2-
-- macroblock2-canonical-data-model-manifest-architecture-2026-10-02.md, through Freeze Patch #3.

-- =========================================================================
-- fact.superseded_by: DEFERRABLE self-FK (same reason/pattern as answer.superseded_by, 0001)
-- =========================================================================
ALTER TABLE "fact" ADD CONSTRAINT "fact_superseded_by_fact_id_fk" FOREIGN KEY ("superseded_by")
  REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;

-- =========================================================================
-- precision_instance: append-only, scope/project_id immutable (§3/§4)
-- =========================================================================
CREATE FUNCTION precision_instance_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'precision_instance rows are never deleted (instance %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.scope <> OLD.scope OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'precision_instance % identity (project_id, scope, created_at) is immutable', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER precision_instance_guard_trigger
  BEFORE UPDATE OR DELETE ON precision_instance
  FOR EACH ROW EXECUTE FUNCTION precision_instance_guard();

-- =========================================================================
-- precision_assessment: 4-state machine (Master Contract §1.8), manifest_version pinned at
-- creation, split_recommendation write-once, service_map_snapshot_id sanctioned-write-only
-- =========================================================================
CREATE FUNCTION precision_assessment_lifecycle_valid(p_from pa_status, p_to pa_status) RETURNS BOOLEAN AS $$
  SELECT (p_from, p_to) IN (
    ('not_started', 'in_progress'),
    ('in_progress', 'ready_for_confirmation'),
    ('ready_for_confirmation', 'in_progress'),       -- readiness flips false before confirmation
    ('ready_for_confirmation', 'confirmed'),
    ('confirmed', 'in_progress')                     -- reopen, client-initiated only (§1.8/§1.10)
  );
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION precision_assessment_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'precision_assessment rows are never deleted (instance %)', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'not_started' OR NEW.confirmed_at IS NOT NULL OR NEW.service_map_snapshot_id IS NOT NULL THEN
      RAISE EXCEPTION 'a precision_assessment always starts not_started, unconfirmed, with no snapshot' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id <> OLD.instance_id OR NEW.manifest_version <> OLD.manifest_version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'precision_assessment % identity and pinned manifest_version are immutable', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.split_recommendation IS NOT NULL AND NEW.split_recommendation IS DISTINCT FROM OLD.split_recommendation THEN
    RAISE EXCEPTION 'precision_assessment % split_recommendation is write-once', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NOT precision_assessment_lifecycle_valid(OLD.lifecycle_status, NEW.lifecycle_status) THEN
    RAISE EXCEPTION 'precision_assessment % cannot move from % to %', OLD.instance_id, OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'BV409';
  END IF;
  -- confirmed_at is maintained automatically: set on every transition into 'confirmed', never cleared
  -- by a later reopen (§5 — "no stored paused state"; a reopen does not erase the prior confirmation
  -- event, it is simply superseded by a later one on the *next* transition into 'confirmed').
  IF NEW.lifecycle_status = 'confirmed' AND OLD.lifecycle_status <> 'confirmed' THEN
    -- clock_timestamp(), not now(): this must be the real event time, not the enclosing
    -- transaction's start time, so a reconfirmation inside a long-running transaction (or a test
    -- harness that runs the whole suite in one transaction) still advances.
    NEW.confirmed_at := clock_timestamp();
  ELSIF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'precision_assessment % confirmed_at is maintained only by the confirmation transition itself', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  -- service_map_snapshot_id is the single sanctioned pointer (§11's current_pack_id pattern, mirrored):
  -- writable only by precision_assessment_confirm() below, via the transaction-local authorization flag.
  IF NEW.service_map_snapshot_id IS DISTINCT FROM OLD.service_map_snapshot_id
     AND COALESCE(current_setting('app.psm_confirmation_authorized', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'precision_assessment.service_map_snapshot_id is written only by precision_assessment_confirm()' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER precision_assessment_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON precision_assessment
  FOR EACH ROW EXECUTE FUNCTION precision_assessment_guard();

-- =========================================================================
-- category_assessment: 5-state machine (Master Contract §1.8), project_id/category_key/
-- manifest_version/category_origin immutable, current_pack_id sanctioned-write-only, and the
-- denormalized project_id must always match its owning precision_instance (cross-project-leak guard)
-- =========================================================================
CREATE FUNCTION category_assessment_lifecycle_valid(p_from category_status, p_to category_status) RETURNS BOOLEAN AS $$
  SELECT (p_from, p_to) IN (
    ('proposed', 'not_selected'),
    ('proposed', 'confirmed'),
    ('not_selected', 'confirmed'),      -- Add Category reactivation (§22) — safe: a not_selected
                                        -- category never collected any Facts (Macroblock 1 §21).
    ('confirmed', 'in_progress'),
    ('in_progress', 'completed'),
    ('completed', 'in_progress')        -- reopen, client-initiated only; readiness flips false
  );
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION category_assessment_guard() RETURNS TRIGGER AS $$
DECLARE
  v_owning_project_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'category_assessment rows are never deleted (instance %)', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_owning_project_id FROM precision_instance WHERE id = NEW.instance_id AND scope = 'category';
    IF v_owning_project_id IS NULL THEN
      RAISE EXCEPTION 'category_assessment % must point at a precision_instance with scope=category in the same project', NEW.instance_id USING ERRCODE = 'BV409';
    END IF;
    IF v_owning_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'category_assessment % project_id must match its owning precision_instance (cross-project scoping violation)', NEW.instance_id USING ERRCODE = 'BV409';
    END IF;
    IF NEW.current_pack_id IS NOT NULL THEN
      RAISE EXCEPTION 'a category_assessment never starts with a current_pack_id' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id <> OLD.instance_id OR NEW.project_id <> OLD.project_id OR NEW.category_key <> OLD.category_key
     OR NEW.manifest_version <> OLD.manifest_version OR NEW.category_origin <> OLD.category_origin OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'category_assessment % identity, pinned manifest_version and category_origin are immutable', OLD.instance_id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NOT category_assessment_lifecycle_valid(OLD.lifecycle_status, NEW.lifecycle_status) THEN
    RAISE EXCEPTION 'category_assessment % cannot move from % to %', OLD.instance_id, OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'BV409';
  END IF;
  IF NEW.current_pack_id IS DISTINCT FROM OLD.current_pack_id
     AND COALESCE(current_setting('app.pack_completion_authorized', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'category_assessment.current_pack_id is written only by category_assessment_complete()' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER category_assessment_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON category_assessment
  FOR EACH ROW EXECUTE FUNCTION category_assessment_guard();

-- =========================================================================
-- fact: append-only; exactly one superseded_by write (NULL -> a later fact's id) ever permitted;
-- scope_instance_id's owning project must match fact.project_id (cross-project-leak guard, §3A)
-- =========================================================================
CREATE FUNCTION fact_guard() RETURNS TRIGGER AS $$
DECLARE
  v_owning_project_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fact rows are never deleted (fact %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_owning_project_id FROM precision_instance WHERE id = NEW.scope_instance_id;
    IF v_owning_project_id IS NULL OR v_owning_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'fact.project_id must match the owning precision_instance of scope_instance_id % (cross-project scoping violation)', NEW.scope_instance_id USING ERRCODE = 'BV409';
    END IF;
    IF NEW.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'a fact never starts already superseded' USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.project_id <> OLD.project_id OR NEW.scope_instance_id <> OLD.scope_instance_id OR NEW.field_key <> OLD.field_key
     OR NEW.value IS DISTINCT FROM OLD.value OR NEW.value_type <> OLD.value_type OR NEW.answer_state <> OLD.answer_state
     OR NEW.source <> OLD.source OR NEW.provenance_stage <> OLD.provenance_stage
     OR NEW.confidence IS DISTINCT FROM OLD.confidence OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'fact % is immutable except for superseded_by, set exactly once', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'fact % is already superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fact_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON fact
  FOR EACH ROW EXECUTE FUNCTION fact_guard();

-- Atomic Fact-versioning transaction (brief §"strong integrity choices"): supersede the current row
-- for (scope_instance_id, field_key), if any, and insert the new one, as a single sanctioned write
-- path with a row lock preventing two concurrent corrections of the same field from racing.
CREATE FUNCTION fact_record(
  p_project_id UUID, p_scope_instance_id UUID, p_field_key TEXT, p_value JSONB, p_value_type TEXT,
  p_answer_state fact_answer_state, p_source fact_source, p_provenance_stage fact_provenance_stage,
  p_confidence REAL DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_old_id UUID;
  -- Generated here, not left to the column default: the old row must be pointed at the new id
  -- BEFORE the new row is inserted (see below), so the id has to be known up front.
  v_new_id UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_old_id FROM fact
    WHERE scope_instance_id = p_scope_instance_id AND field_key = p_field_key AND superseded_by IS NULL
    FOR UPDATE;

  -- Order matters: the partial unique index (scope_instance_id, field_key) WHERE superseded_by IS
  -- NULL is checked immediately per statement (it is a plain index, not a DEFERRABLE constraint), so
  -- superseding the old row FIRST removes it from that index's predicate before the new row (which
  -- also matches the predicate) is inserted — inserting first would transiently violate the index.
  IF v_old_id IS NOT NULL THEN
    UPDATE fact SET superseded_by = v_new_id WHERE id = v_old_id;
  END IF;

  INSERT INTO fact (id, project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage, confidence)
  VALUES (v_new_id, p_project_id, p_scope_instance_id, p_field_key, p_value, p_value_type, p_answer_state, p_source, p_provenance_stage, p_confidence);

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- service_map_snapshot / pack: fully immutable once inserted (§2/§3)
-- =========================================================================
CREATE FUNCTION immutable_row_guard() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are never updated or deleted (id %)', TG_TABLE_NAME, OLD.id USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_map_snapshot_immutable_trigger
  BEFORE UPDATE OR DELETE ON service_map_snapshot
  FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();

CREATE TRIGGER pack_immutable_trigger
  BEFORE UPDATE OR DELETE ON pack
  FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();

-- precision_instance.scope must be 'project' for any service_map_snapshot (plain FK cannot assert
-- the referenced row's own scope value).
CREATE FUNCTION service_map_snapshot_scope_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM precision_instance WHERE id = NEW.precision_instance_id AND scope = 'project') THEN
    RAISE EXCEPTION 'service_map_snapshot.precision_instance_id % must reference a scope=project instance', NEW.precision_instance_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_map_snapshot_scope_guard_trigger
  BEFORE INSERT ON service_map_snapshot
  FOR EACH ROW EXECUTE FUNCTION service_map_snapshot_scope_guard();

-- Atomic PA confirmation (§11's current_pack_id pattern, mirrored for service_map_snapshot): one
-- INSERT + one sanctioned UPDATE in the same transaction, exactly like category_assessment_complete.
CREATE FUNCTION precision_assessment_confirm(p_instance_id UUID, p_content JSONB) RETURNS UUID AS $$
DECLARE
  v_status pa_status;
  v_next_version INTEGER;
  v_snapshot_id UUID;
BEGIN
  SELECT lifecycle_status INTO v_status FROM precision_assessment WHERE instance_id = p_instance_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'precision_assessment % not found', p_instance_id USING ERRCODE = 'BV404';
  END IF;
  IF v_status <> 'ready_for_confirmation' THEN
    RAISE EXCEPTION 'precision_assessment % must be ready_for_confirmation to confirm (currently %)', p_instance_id, v_status USING ERRCODE = 'BV409';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version FROM service_map_snapshot WHERE precision_instance_id = p_instance_id;
  INSERT INTO service_map_snapshot (precision_instance_id, version, content)
  VALUES (p_instance_id, v_next_version, p_content)
  RETURNING id INTO v_snapshot_id;

  PERFORM set_config('app.psm_confirmation_authorized', 'true', true);
  UPDATE precision_assessment SET lifecycle_status = 'confirmed', service_map_snapshot_id = v_snapshot_id WHERE instance_id = p_instance_id;
  PERFORM set_config('app.psm_confirmation_authorized', 'false', true);

  RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql;

-- Atomic category completion (§11's exact recommendation: "setting it is one UPDATE in the same
-- transaction as the INSERT of the new pack row — atomic by construction").
CREATE FUNCTION category_assessment_complete(p_instance_id UUID, p_content JSONB, p_context_snapshot JSONB) RETURNS UUID AS $$
DECLARE
  v_status category_status;
  v_next_version INTEGER;
  v_pack_id UUID;
BEGIN
  SELECT lifecycle_status INTO v_status FROM category_assessment WHERE instance_id = p_instance_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'category_assessment % not found', p_instance_id USING ERRCODE = 'BV404';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'category_assessment % must be in_progress to complete (currently %)', p_instance_id, v_status USING ERRCODE = 'BV409';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version FROM pack WHERE category_assessment_instance_id = p_instance_id;
  INSERT INTO pack (category_assessment_instance_id, version, content, context_snapshot)
  VALUES (p_instance_id, v_next_version, p_content, p_context_snapshot)
  RETURNING id INTO v_pack_id;

  PERFORM set_config('app.pack_completion_authorized', 'true', true);
  UPDATE category_assessment SET lifecycle_status = 'completed', current_pack_id = v_pack_id WHERE instance_id = p_instance_id;
  PERFORM set_config('app.pack_completion_authorized', 'false', true);

  RETURN v_pack_id;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- project_manifest_version / category_manifest_version: PUBLISHED rows are immutable except the
-- is_current repoint; "reuse config_publish ... unchanged in shape" (§19), simplified to a direct
-- DRAFT -> PUBLISHED publish (no diff-review workflow — routine implementation scope reduction,
-- see the Macroblock 4 completion report; additive later if ever needed, same discipline as §6).
-- =========================================================================
CREATE FUNCTION project_manifest_version_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project_manifest_version rows are never deleted (version %)', OLD.version USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'PUBLISHED' AND (NEW.version <> OLD.version OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.status <> OLD.status
     OR NEW.published_at <> OLD.published_at OR NEW.published_by_admin_user_id <> OLD.published_by_admin_user_id) THEN
    RAISE EXCEPTION 'project_manifest_version % is published and immutable except is_current', OLD.version USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_manifest_version_guard_trigger
  BEFORE UPDATE OR DELETE ON project_manifest_version
  FOR EACH ROW EXECUTE FUNCTION project_manifest_version_guard();

CREATE FUNCTION category_manifest_version_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'category_manifest_version rows are never deleted (id %)', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF NEW.category_key <> OLD.category_key OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'category_manifest_version % identity is immutable', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status = 'PUBLISHED' AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.status <> OLD.status OR NEW.published_at <> OLD.published_at OR NEW.published_by_admin_user_id <> OLD.published_by_admin_user_id) THEN
    RAISE EXCEPTION 'category_manifest_version % is published and immutable except is_current', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER category_manifest_version_guard_trigger
  BEFORE UPDATE OR DELETE ON category_manifest_version
  FOR EACH ROW EXECUTE FUNCTION category_manifest_version_guard();

-- Publish + atomic current-pointer repoint, one project-wide registry (§19).
CREATE FUNCTION precision_project_manifest_publish(p_version TEXT, p_actor_admin_user_id UUID) RETURNS VOID AS $$
BEGIN
  UPDATE project_manifest_version
     SET status = 'PUBLISHED', content_hash = COALESCE(content_hash, md5(content::text)),
         published_at = now(), published_by_admin_user_id = p_actor_admin_user_id
   WHERE version = p_version AND status <> 'PUBLISHED';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM project_manifest_version WHERE version = p_version AND status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'project_manifest_version % not found', p_version USING ERRCODE = 'BV404';
  END IF;

  UPDATE project_manifest_version SET is_current = false WHERE is_current AND version <> p_version;
  UPDATE project_manifest_version SET is_current = true WHERE version = p_version;
END;
$$ LANGUAGE plpgsql;

-- Publish + atomic current-pointer repoint, per category_key (§19 — independent per-category registries).
CREATE FUNCTION precision_category_manifest_publish(p_category_key TEXT, p_version TEXT, p_actor_admin_user_id UUID) RETURNS VOID AS $$
BEGIN
  UPDATE category_manifest_version
     SET status = 'PUBLISHED', content_hash = COALESCE(content_hash, md5(content::text)),
         published_at = now(), published_by_admin_user_id = p_actor_admin_user_id
   WHERE category_key = p_category_key AND version = p_version AND status <> 'PUBLISHED';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM category_manifest_version WHERE category_key = p_category_key AND version = p_version AND status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'category_manifest_version %/% not found', p_category_key, p_version USING ERRCODE = 'BV404';
  END IF;

  UPDATE category_manifest_version SET is_current = false WHERE category_key = p_category_key AND is_current AND version <> p_version;
  UPDATE category_manifest_version SET is_current = true WHERE category_key = p_category_key AND version = p_version;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- project.split_from_project_id: write-once (set only at creation by the Project-domain creation
-- flow, §3A — never repointed afterward)
-- =========================================================================
CREATE FUNCTION project_split_from_immutable_guard() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.split_from_project_id IS NOT NULL AND NEW.split_from_project_id IS DISTINCT FROM OLD.split_from_project_id THEN
    RAISE EXCEPTION 'project % split_from_project_id is write-once', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_split_from_immutable_guard_trigger
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_split_from_immutable_guard();
