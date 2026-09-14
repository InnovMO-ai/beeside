
-- =========================================================================
-- Guards: the only write path into the registries and their audit tables is the functions below.
-- Invariants (PREVIEW frozen, PUBLISHED immutable) hold even when the write path is authorized.
-- =========================================================================
CREATE FUNCTION config_version_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted (version %)', TG_TABLE_NAME, OLD.version USING ERRCODE = 'BV409';
  END IF;
  IF current_setting('app.config_mutation_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '% can only be changed through the config_* versioning functions', TG_TABLE_NAME
      USING ERRCODE = 'BV403';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.is_current OR NEW.content_hash IS NOT NULL OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'new % rows must start as a non-current DRAFT', TG_TABLE_NAME USING ERRCODE = 'BV409';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by_admin_user_id IS DISTINCT FROM OLD.created_by_admin_user_id THEN
    RAISE EXCEPTION 'identity columns of %.% are immutable', TG_TABLE_NAME, OLD.version USING ERRCODE = 'BV409';
  END IF;

  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.config IS DISTINCT FROM OLD.config
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.change_kind IS DISTINCT FROM OLD.change_kind
       OR NEW.base_version IS DISTINCT FROM OLD.base_version OR NEW.previewed_at IS DISTINCT FROM OLD.previewed_at
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by_admin_user_id IS DISTINCT FROM OLD.published_by_admin_user_id THEN
      RAISE EXCEPTION '%.% is PUBLISHED and immutable; only the current pointer may move', TG_TABLE_NAME, OLD.version
        USING ERRCODE = 'BV409';
    END IF;
  ELSIF OLD.status = 'PREVIEW' THEN
    IF NEW.config IS DISTINCT FROM OLD.config
       OR (NEW.status <> 'DRAFT' AND (NEW.content_hash IS DISTINCT FROM OLD.content_hash
           OR NEW.change_kind IS DISTINCT FROM OLD.change_kind OR NEW.base_version IS DISTINCT FROM OLD.base_version
           OR NEW.previewed_at IS DISTINCT FROM OLD.previewed_at)) THEN
      RAISE EXCEPTION '%.% is frozen in PREVIEW; return it to DRAFT before changing it', TG_TABLE_NAME, OLD.version
        USING ERRCODE = 'BV409';
    END IF;
  ELSIF NEW.status = 'PUBLISHED' THEN
    RAISE EXCEPTION '%.% is a DRAFT and cannot be published directly; preview and review it first', TG_TABLE_NAME, OLD.version
      USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_audit_insert_guard() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.config_mutation_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '% rows can only be written by the config_* versioning functions', TG_TABLE_NAME
      USING ERRCODE = 'BV403';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- Lifecycle: Draft → Preview → (Review) → Publish, plus current-pointer repoint (rollback)
-- =========================================================================
CREATE FUNCTION config_create_draft(p_registry config_registry, p_version TEXT, p_config JSONB, p_actor UUID)
RETURNS void AS $$
BEGIN
  PERFORM config_require_admin(p_actor);
  IF p_registry IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  IF p_version IS NULL OR p_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' THEN
    RAISE EXCEPTION 'version identifier % is invalid (1-64 characters: letters, digits, dot, underscore, hyphen)', p_version
      USING ERRCODE = 'BV422';
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'bundle must be a JSON object' USING ERRCODE = 'BV422';
  END IF;
  PERFORM config_set_write_authorized(true);
  EXECUTE format('INSERT INTO %I (version, config, created_by_admin_user_id) VALUES ($1, $2, $3)',
                 config_registry_table(p_registry))
    USING p_version, p_config, p_actor;
  PERFORM config_log_event(p_registry, p_version, 'DRAFT_CREATED', NULL, 'DRAFT', NULL, p_actor, '{}');
  PERFORM config_set_write_authorized(false);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_update_draft(p_registry config_registry, p_version TEXT, p_config JSONB, p_actor UUID)
RETURNS void AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  EXECUTE format('SELECT status FROM %I WHERE version = $1 FOR UPDATE', v_table) INTO v_status USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'only DRAFT bundles can be edited (%.% is %)', v_table, p_version, v_status USING ERRCODE = 'BV409';
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'bundle must be a JSON object' USING ERRCODE = 'BV422';
  END IF;
  PERFORM config_set_write_authorized(true);
  EXECUTE format('UPDATE %I SET config = $2 WHERE version = $1', v_table) USING p_version, p_config;
  PERFORM config_log_event(p_registry, p_version, 'DRAFT_UPDATED', 'DRAFT', 'DRAFT', NULL, p_actor, '{}');
  PERFORM config_set_write_authorized(false);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_submit_for_preview(p_registry config_registry, p_version TEXT, p_actor UUID)
RETURNS JSONB AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
  v_config JSONB;
  v_errors TEXT[];
  v_current TEXT;
  v_current_config JSONB;
  v_kind config_change_kind;
  v_hash TEXT;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('beeside.config.' || v_table));
  EXECUTE format('SELECT status, config FROM %I WHERE version = $1 FOR UPDATE', v_table)
    INTO v_status, v_config USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'only DRAFT bundles can be submitted for preview (%.% is %)', v_table, p_version, v_status
      USING ERRCODE = 'BV409';
  END IF;

  v_errors := config_validate_bundle(p_registry, v_config);
  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION 'bundle validation failed: %', array_to_string(v_errors, '; ') USING ERRCODE = 'BV422';
  END IF;

  EXECUTE format('SELECT version, config FROM %I WHERE is_current', v_table) INTO v_current, v_current_config;
  IF v_current_config IS NOT NULL AND v_current_config = v_config THEN
    RAISE EXCEPTION 'bundle is identical to the current published version %', v_current USING ERRCODE = 'BV422';
  END IF;

  v_kind := config_classify_change(p_registry, v_current_config, v_config);
  v_hash := config_content_hash(v_config);

  PERFORM config_set_write_authorized(true);
  EXECUTE format('UPDATE %I SET status = ''PREVIEW'', content_hash = $2, change_kind = $3, base_version = $4, previewed_at = now()
                  WHERE version = $1', v_table)
    USING p_version, v_hash, v_kind, v_current;
  PERFORM config_log_event(p_registry, p_version, 'SUBMITTED_FOR_PREVIEW', 'DRAFT', 'PREVIEW', v_hash, p_actor,
    jsonb_build_object('base_version', v_current, 'change_kind', v_kind));
  PERFORM config_set_write_authorized(false);

  RETURN jsonb_build_object('version', p_version, 'status', 'PREVIEW', 'change_kind', v_kind,
    'content_hash', v_hash, 'base_version', v_current, 'diff', config_jsonb_diff(v_current_config, v_config));
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_return_to_draft(p_registry config_registry, p_version TEXT, p_actor UUID, p_reason TEXT)
RETURNS void AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
  v_hash TEXT;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  EXECUTE format('SELECT status, content_hash FROM %I WHERE version = $1 FOR UPDATE', v_table)
    INTO v_status, v_hash USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status <> 'PREVIEW' THEN
    RAISE EXCEPTION 'only PREVIEW bundles can return to DRAFT (%.% is %)', v_table, p_version, v_status
      USING ERRCODE = 'BV409';
  END IF;
  PERFORM config_set_write_authorized(true);
  EXECUTE format('UPDATE %I SET status = ''DRAFT'', content_hash = NULL, change_kind = NULL, base_version = NULL,
                  previewed_at = NULL WHERE version = $1', v_table)
    USING p_version;
  PERFORM config_log_event(p_registry, p_version, 'RETURNED_TO_DRAFT', 'PREVIEW', 'DRAFT', v_hash, p_actor,
    jsonb_build_object('reason', p_reason));
  PERFORM config_set_write_authorized(false);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_record_review(
  p_registry config_registry, p_version TEXT, p_actor UUID,
  p_decision config_review_decision, p_diff_reviewed BOOLEAN, p_notes TEXT
) RETURNS UUID AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
  v_config JSONB;
  v_hash TEXT;
  v_kind config_change_kind;
  v_base TEXT;
  v_base_config JSONB;
  v_base_hash TEXT;
  v_diff JSONB;
  v_review_id UUID;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  EXECUTE format('SELECT status, config, content_hash, change_kind, base_version FROM %I WHERE version = $1 FOR UPDATE', v_table)
    INTO v_status, v_config, v_hash, v_kind, v_base USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status <> 'PREVIEW' THEN
    RAISE EXCEPTION 'only PREVIEW bundles can be reviewed (%.% is %)', v_table, p_version, v_status USING ERRCODE = 'BV409';
  END IF;
  IF p_decision IS NULL THEN
    RAISE EXCEPTION 'review decision is required' USING ERRCODE = 'BV422';
  ELSIF p_decision = 'REJECTED' AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'a rejection must include notes explaining why' USING ERRCODE = 'BV422';
  ELSIF p_decision = 'APPROVED' AND v_kind = 'LOGIC_SCHEMA' AND p_diff_reviewed IS NOT TRUE THEN
    RAISE EXCEPTION 'logic/schema change: approval requires an explicit diff review (diff_reviewed = true)'
      USING ERRCODE = 'BV412';
  END IF;

  IF v_base IS NOT NULL THEN
    EXECUTE format('SELECT config, content_hash FROM %I WHERE version = $1', v_table)
      INTO v_base_config, v_base_hash USING v_base;
  END IF;
  v_diff := config_jsonb_diff(v_base_config, v_config);

  PERFORM config_set_write_authorized(true);
  EXECUTE format(
    'INSERT INTO config_version_review (registry, %I, content_hash, base_version, base_content_hash, change_kind, diff,
       diff_reviewed, decision, notes, reviewer_admin_user_id, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp()) RETURNING review_id', v_table)
    INTO v_review_id
    USING p_registry, p_version, v_hash, v_base, v_base_hash, v_kind, v_diff, COALESCE(p_diff_reviewed, false),
          p_decision, p_notes, p_actor;
  PERFORM config_log_event(p_registry, p_version, 'REVIEW_RECORDED', 'PREVIEW', 'PREVIEW', v_hash, p_actor,
    jsonb_build_object('review_id', v_review_id, 'decision', p_decision, 'change_kind', v_kind,
                       'diff_reviewed', COALESCE(p_diff_reviewed, false), 'changes', jsonb_array_length(v_diff)));
  PERFORM config_set_write_authorized(false);
  RETURN v_review_id;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_publish(p_registry config_registry, p_version TEXT, p_actor UUID)
RETURNS JSONB AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
  v_hash TEXT;
  v_kind config_change_kind;
  v_base TEXT;
  v_current TEXT;
  v_review_id UUID;
  v_decision config_review_decision;
  v_diff_reviewed BOOLEAN;
  v_review_hash TEXT;
  v_review_base TEXT;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('beeside.config.' || v_table));
  EXECUTE format('SELECT status, content_hash, change_kind, base_version FROM %I WHERE version = $1 FOR UPDATE', v_table)
    INTO v_status, v_hash, v_kind, v_base USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status = 'DRAFT' THEN
    RAISE EXCEPTION 'publish refused: %.% is a DRAFT; submit it for preview and record a review first', v_table, p_version
      USING ERRCODE = 'BV409';
  ELSIF v_status = 'PUBLISHED' THEN
    RAISE EXCEPTION '%.% is already published', v_table, p_version USING ERRCODE = 'BV409';
  END IF;

  EXECUTE format('SELECT version FROM %I WHERE is_current', v_table) INTO v_current;
  IF v_current IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'publish refused: the current published version changed since preview (previewed against %, current is %); return to draft and preview again',
      v_base, v_current USING ERRCODE = 'BV412';
  END IF;

  EXECUTE format('SELECT review_id, decision, diff_reviewed, content_hash, base_version FROM config_version_review
                  WHERE registry = $1 AND %I = $2 ORDER BY reviewed_at DESC, review_id DESC LIMIT 1', v_table)
    INTO v_review_id, v_decision, v_diff_reviewed, v_review_hash, v_review_base USING p_registry, p_version;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'publish refused: no review recorded for %.%', v_table, p_version USING ERRCODE = 'BV412';
  ELSIF v_review_hash IS DISTINCT FROM v_hash OR v_review_base IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'publish refused: the latest review of %.% covers different content or a different base', v_table, p_version
      USING ERRCODE = 'BV412';
  ELSIF v_decision <> 'APPROVED' THEN
    RAISE EXCEPTION 'publish refused: the latest review of %.% rejected it', v_table, p_version USING ERRCODE = 'BV412';
  ELSIF v_kind = 'LOGIC_SCHEMA' AND v_diff_reviewed IS NOT TRUE THEN
    RAISE EXCEPTION 'publish refused: logic/schema change %.% has no recorded diff review', v_table, p_version
      USING ERRCODE = 'BV412';
  END IF;

  PERFORM config_set_write_authorized(true);
  IF v_current IS NOT NULL THEN
    EXECUTE format('UPDATE %I SET is_current = false WHERE version = $1', v_table) USING v_current;
  END IF;
  EXECUTE format('UPDATE %I SET status = ''PUBLISHED'', published_at = now(), published_by_admin_user_id = $2,
                  is_current = true WHERE version = $1', v_table)
    USING p_version, p_actor;
  PERFORM config_log_event(p_registry, p_version, 'PUBLISHED', 'PREVIEW', 'PUBLISHED', v_hash, p_actor,
    jsonb_build_object('previous_current', v_current, 'review_id', v_review_id, 'change_kind', v_kind));
  PERFORM config_set_write_authorized(false);

  RETURN jsonb_build_object('version', p_version, 'status', 'PUBLISHED', 'is_current', true,
    'previous_current', v_current, 'review_id', v_review_id, 'change_kind', v_kind);
END;
$$ LANGUAGE plpgsql;

-- Rollback / roll-forward: repoint "current" at another already-published version. Content is never
-- touched; only future assessment_started events are affected.
CREATE FUNCTION config_set_current(p_registry config_registry, p_version TEXT, p_actor UUID, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_table TEXT := config_registry_table(p_registry);
  v_status config_version_status;
  v_is_current BOOLEAN;
  v_hash TEXT;
  v_current TEXT;
BEGIN
  PERFORM config_require_admin(p_actor);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'registry is required' USING ERRCODE = 'BV422';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'changing the current version requires a reason' USING ERRCODE = 'BV422';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('beeside.config.' || v_table));
  EXECUTE format('SELECT status, is_current, content_hash FROM %I WHERE version = $1 FOR UPDATE', v_table)
    INTO v_status, v_is_current, v_hash USING p_version;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '% % not found', v_table, p_version USING ERRCODE = 'BV404';
  ELSIF v_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'only PUBLISHED versions can become current (%.% is %)', v_table, p_version, v_status
      USING ERRCODE = 'BV409';
  ELSIF v_is_current THEN
    RAISE EXCEPTION '%.% is already the current version', v_table, p_version USING ERRCODE = 'BV409';
  END IF;

  EXECUTE format('SELECT version FROM %I WHERE is_current', v_table) INTO v_current;
  PERFORM config_set_write_authorized(true);
  IF v_current IS NOT NULL THEN
    EXECUTE format('UPDATE %I SET is_current = false WHERE version = $1', v_table) USING v_current;
  END IF;
  EXECUTE format('UPDATE %I SET is_current = true WHERE version = $1', v_table) USING p_version;
  PERFORM config_log_event(p_registry, p_version, 'CURRENT_REPOINTED', 'PUBLISHED', 'PUBLISHED', v_hash, p_actor,
    jsonb_build_object('previous_current', v_current, 'reason', p_reason));
  PERFORM config_set_write_authorized(false);

  RETURN jsonb_build_object('version', p_version, 'is_current', true, 'previous_current', v_current);
END;
$$ LANGUAGE plpgsql;
