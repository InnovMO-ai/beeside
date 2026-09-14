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
