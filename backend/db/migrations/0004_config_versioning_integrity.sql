-- Phase 3 — custom SQL migration (drizzle-kit generate --custom): versioned configuration integrity.
-- Technical Architecture v1.1 §5 / Functional Specification v1 §10:
--   * three registries, Draft → Preview → Publish, changed only through the config_* functions below;
--   * content-only publishes need an ADMIN approval; logic/schema publishes additionally need an
--     explicit diff review, enforced here (the publish function refuses), not by convention;
--   * PREVIEW freezes a bundle, PUBLISHED is immutable, only the current pointer may move (rollback);
--   * projects pin the current published versions at assessment_started (project INSERT), forever.
-- Error codes (SQLSTATE) are part of the API contract used by the backend service:
--   BV403 forbidden actor / write path · BV404 not found · BV409 invalid lifecycle transition
--   BV412 publication gate / precondition failed · BV422 bundle validation failed

-- =========================================================================
-- Helpers
-- =========================================================================
CREATE FUNCTION config_registry_table(p_registry config_registry) RETURNS text AS $$
BEGIN
  RETURN CASE p_registry
    WHEN 'QUESTION_BANK' THEN 'question_bank_version'
    WHEN 'RULES_ENGINE' THEN 'rules_engine_version'
    WHEN 'SNAPSHOT_TEMPLATE' THEN 'snapshot_template_version'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION config_require_admin(p_actor UUID) RETURNS void AS $$
DECLARE
  v_role admin_role;
  v_active BOOLEAN;
BEGIN
  SELECT role, active INTO v_role, v_active FROM admin_user WHERE admin_user_id = p_actor;
  IF v_role IS DISTINCT FROM 'ADMIN' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'configuration changes require an active ADMIN actor (actor %)', p_actor
      USING ERRCODE = 'BV403';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Transaction-local authorization flag read by the guard triggers. Set only for the duration of a
-- config_* function body; a subtransaction rollback reverts it automatically.
CREATE FUNCTION config_set_write_authorized(p_on BOOLEAN) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.config_mutation_authorized', CASE WHEN p_on THEN 'true' ELSE 'false' END, true);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION config_content_hash(p_config JSONB) RETURNS text AS $$
BEGIN
  -- jsonb has a canonical text form (sorted keys, normalized whitespace), so equal bundles hash equally.
  RETURN encode(sha256(convert_to(p_config::text, 'UTF8')), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Removes every `copy` subtree (localized presentation text) recursively. What remains is the
-- bundle's logic/schema: ids, field keys, types, option values, applicability, structure.
CREATE FUNCTION config_strip_copy(p JSONB) RETURNS JSONB AS $$
BEGIN
  IF jsonb_typeof(p) = 'object' THEN
    RETURN COALESCE(
      (SELECT jsonb_object_agg(e.key, config_strip_copy(e.value)) FROM jsonb_each(p) AS e WHERE e.key <> 'copy'),
      '{}'::jsonb);
  ELSIF jsonb_typeof(p) = 'array' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(config_strip_copy(a.value) ORDER BY a.ordinality) FROM jsonb_array_elements(p) WITH ORDINALITY AS a),
      '[]'::jsonb);
  END IF;
  RETURN p;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Structural diff: jsonb array of {path, op: added|removed|changed, before?, after?}.
-- Arrays are compared by position (reordering is a real change).
CREATE FUNCTION config_jsonb_diff(p_base JSONB, p_new JSONB, p_path TEXT DEFAULT '$') RETURNS JSONB AS $$
DECLARE
  v_result JSONB := '[]'::jsonb;
  v_key TEXT;
  v_len INT;
BEGIN
  IF p_base IS NOT DISTINCT FROM p_new THEN
    RETURN v_result;
  ELSIF p_base IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('path', p_path, 'op', 'added', 'after', p_new));
  ELSIF p_new IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('path', p_path, 'op', 'removed', 'before', p_base));
  ELSIF jsonb_typeof(p_base) = 'object' AND jsonb_typeof(p_new) = 'object' THEN
    FOR v_key IN
      SELECT k FROM (SELECT jsonb_object_keys(p_base) AS k UNION SELECT jsonb_object_keys(p_new)) AS keys
      ORDER BY k COLLATE "C"
    LOOP
      v_result := v_result || config_jsonb_diff(p_base -> v_key, p_new -> v_key, p_path || '.' || v_key);
    END LOOP;
    RETURN v_result;
  ELSIF jsonb_typeof(p_base) = 'array' AND jsonb_typeof(p_new) = 'array' THEN
    v_len := greatest(jsonb_array_length(p_base), jsonb_array_length(p_new));
    FOR i IN 0 .. v_len - 1 LOOP
      v_result := v_result || config_jsonb_diff(p_base -> i, p_new -> i, p_path || '[' || i || ']');
    END LOOP;
    RETURN v_result;
  END IF;
  RETURN jsonb_build_array(jsonb_build_object('path', p_path, 'op', 'changed', 'before', p_base, 'after', p_new));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- The change kind is derived, never declared by the author. Rules-engine bundles are logic by
-- definition; a first version (no base) is schema; otherwise CONTENT only if nothing outside
-- `copy` subtrees changed.
CREATE FUNCTION config_classify_change(p_registry config_registry, p_base JSONB, p_new JSONB)
RETURNS config_change_kind AS $$
BEGIN
  IF p_registry = 'RULES_ENGINE' OR p_base IS NULL THEN
    RETURN 'LOGIC_SCHEMA';
  ELSIF config_strip_copy(p_base) = config_strip_copy(p_new) THEN
    RETURN 'CONTENT';
  END IF;
  RETURN 'LOGIC_SCHEMA';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Locale completeness ("a locale must be complete before it can be published"): every `copy`
-- object must carry every declared locale, with no empty strings inside.
CREATE FUNCTION config_copy_gaps(p JSONB, p_locales TEXT[], p_path TEXT) RETURNS TEXT[] AS $$
DECLARE
  v_gaps TEXT[] := '{}';
  v_key TEXT;
  v_value JSONB;
  v_locale TEXT;
BEGIN
  IF jsonb_typeof(p) = 'object' THEN
    FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p) AS e ORDER BY e.key COLLATE "C" LOOP
      IF v_key = 'copy' THEN
        IF jsonb_typeof(v_value) <> 'object' THEN
          v_gaps := array_append(v_gaps, format('%s.copy must be an object keyed by locale', p_path));
        ELSE
          FOREACH v_locale IN ARRAY p_locales LOOP
            IF NOT (v_value ? v_locale)
               OR jsonb_typeof(v_value -> v_locale) NOT IN ('string', 'object')
               OR (v_value -> v_locale) IN ('""'::jsonb, '{}'::jsonb)
               OR jsonb_path_exists(v_value -> v_locale, 'strict $.** ? (@.type() == "string" && @ == "")') THEN
              v_gaps := array_append(v_gaps, format('%s.copy is missing or has empty text for locale %s', p_path, v_locale));
            END IF;
          END LOOP;
        END IF;
      ELSE
        v_gaps := v_gaps || config_copy_gaps(v_value, p_locales, p_path || '.' || v_key);
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p) - 1 LOOP
      v_gaps := v_gaps || config_copy_gaps(p -> i, p_locales, p_path || '[' || i || ']');
    END LOOP;
  END IF;
  RETURN v_gaps;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Returns validation errors (empty array = valid). Applied at DRAFT → PREVIEW.
CREATE FUNCTION config_validate_bundle(p_registry config_registry, p_config JSONB) RETURNS TEXT[] AS $$
DECLARE
  v_errors TEXT[] := '{}';
  v_locales TEXT[] := '{}';
  v_declared TEXT[] := '{}';
  v_undeclared TEXT[];
  v_ids TEXT[] := '{}';
  v_question JSONB;
  v_index INT := -1;
  v_field_key TEXT;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RETURN ARRAY['bundle must be a JSON object'];
  END IF;

  IF jsonb_typeof(p_config -> 'schema_version') IS DISTINCT FROM 'number'
     OR (p_config ->> 'schema_version') !~ '^[1-9][0-9]*$' THEN
    v_errors := array_append(v_errors, 'schema_version must be a positive integer');
  END IF;

  IF jsonb_typeof(p_config -> 'locales') IS DISTINCT FROM 'array' THEN
    v_errors := array_append(v_errors, 'locales must be a non-empty array of locale codes');
  ELSE
    SELECT COALESCE(array_agg(l), '{}') INTO v_locales FROM jsonb_array_elements_text(p_config -> 'locales') AS l;
    IF cardinality(v_locales) = 0 OR EXISTS (SELECT 1 FROM unnest(v_locales) AS l WHERE l !~ '^[a-z]{2}(-[A-Z]{2})?$') THEN
      v_errors := array_append(v_errors, 'locales must be a non-empty array of locale codes');
    ELSE
      v_errors := v_errors || config_copy_gaps(p_config, v_locales, '$');
    END IF;
  END IF;

  -- Template variables ("variables must be validated before publish").
  IF p_config ? 'variables' THEN
    IF jsonb_typeof(p_config -> 'variables') <> 'array' THEN
      v_errors := array_append(v_errors, 'variables must be an array of names');
    ELSE
      SELECT COALESCE(array_agg(v), '{}') INTO v_declared FROM jsonb_array_elements_text(p_config -> 'variables') AS v;
    END IF;
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_undeclared
  FROM jsonb_path_query(p_config, 'strict $.** ? (@.type() == "string")') AS s(val),
       regexp_matches(s.val #>> '{}', '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') AS m
  WHERE NOT (m[1] = ANY (v_declared));
  IF v_undeclared IS NOT NULL THEN
    v_errors := array_append(v_errors, format('undeclared template variables: %s', array_to_string(v_undeclared, ', ')));
  END IF;

  -- Question bank: stable ids and canonical fa.* field keys that exist in field_key_registry
  -- (itself synced from shared/canonical-fields) — display copy is never the data contract.
  IF p_registry = 'QUESTION_BANK' THEN
    IF jsonb_typeof(p_config -> 'questions') IS DISTINCT FROM 'array' THEN
      v_errors := array_append(v_errors, 'questions must be an array');
    ELSE
      FOR v_question IN SELECT q FROM jsonb_array_elements(p_config -> 'questions') AS q LOOP
        v_index := v_index + 1;
        IF jsonb_typeof(v_question) <> 'object' OR COALESCE(v_question ->> 'id', '') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]*$' THEN
          v_errors := array_append(v_errors, format('questions[%s].id is required', v_index));
        ELSIF (v_question ->> 'id') = ANY (v_ids) THEN
          v_errors := array_append(v_errors, format('questions[%s].id %s is duplicated', v_index, v_question ->> 'id'));
        ELSE
          v_ids := array_append(v_ids, v_question ->> 'id');
        END IF;
        v_field_key := v_question ->> 'field_key';
        IF v_field_key IS NULL OR v_field_key !~ '^fa\.[a-z0-9_]+(\.[a-z0-9_]+)*$' THEN
          v_errors := array_append(v_errors, format('questions[%s].field_key must be a canonical fa.* key', v_index));
        ELSIF NOT EXISTS (SELECT 1 FROM field_key_registry
                          WHERE field_key = v_field_key AND module = 'first_assessment' AND active) THEN
          v_errors := array_append(v_errors,
            format('questions[%s].field_key %s is not an active first_assessment key in field_key_registry', v_index, v_field_key));
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN v_errors;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION config_log_event(
  p_registry config_registry, p_version TEXT, p_event config_version_event_type,
  p_from config_version_status, p_to config_version_status, p_content_hash TEXT,
  p_actor UUID, p_details JSONB
) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'INSERT INTO config_version_event (registry, %I, event_type, from_status, to_status, content_hash, actor_admin_user_id, details, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())', config_registry_table(p_registry))
  USING p_registry, p_version, p_event, p_from, p_to, p_content_hash, p_actor, COALESCE(p_details, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

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
