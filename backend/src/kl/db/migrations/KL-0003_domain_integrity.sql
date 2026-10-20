-- KL-0003 · Vistas de lectura (únicas superficies de SELECT de los roles de aplicación) y permisos de ejecución por rol
-- (CR-KL-002 §8.1). Ninguna tabla se concede: el acceso es solo por vistas y funciones.

-- ---------------------------------------------------------------------------------------------------------------
-- Base consumible: última versión publicada, no retirada ni vencida, por unidad (Design Spec §5.3)
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW kl.v_consumable AS
SELECT u.id AS unit_id, u.unit_key, u.kind, u.country, u.region, u.topic_key, u.category_keys, u.service_ids, u.industry_keys, u.catalog_version, u.content_risk,
       uv.id AS unit_version_id, uv.version, uv.valid_from, uv.valid_to, uv.next_review_at, uv.permitted_use, uv.limits_es, uv.limits_en,
       uv.specialist_required, uv.specialist_category_key, uv.content_sha256, uv.published_at, uv.origin,
       CASE WHEN val.id IS NOT NULL AND val.status = 'valid' AND val.expires_at > now() THEN 'specialist_validated'
            WHEN uv.origin = 'collector' AND uv.approved_by IS NULL THEN 'auto_published'
            ELSE 'reviewed' END AS confidence,
       CASE WHEN NOT (u.content_risk = 'high' OR uv.specialist_required) THEN 'not_required'
            WHEN val.id IS NOT NULL AND val.status = 'valid' AND val.expires_at > now() THEN 'valid'
            ELSE 'expired' END AS validation_state,
       val.id AS validation_id, val.expires_at AS validation_expires_at
  FROM kl.unit u
  JOIN LATERAL (
    SELECT v.* FROM kl.unit_version v
     WHERE v.unit_id = u.id AND v.status = 'published' AND (v.valid_to IS NULL OR v.valid_to > now())
     ORDER BY v.version DESC LIMIT 1
  ) uv ON true
  LEFT JOIN LATERAL (
    SELECT sv.* FROM kl.specialist_validation sv
     WHERE sv.unit_version_id = uv.id AND sv.content_sha256 = uv.content_sha256 AND sv.verdict = 'approved' AND sv.status IN ('valid', 'expired')
     ORDER BY sv.expires_at DESC LIMIT 1
  ) val ON true;

CREATE VIEW kl.v_consumable_stat AS
WITH s AS (
  SELECT c.*, sv.indicator_key, ind.name_es AS indicator_name_es, ind.name_en AS indicator_name_en, ind.direction, sv.geo_code, sv.period_label, sv.period_start, sv.period_end,
         sv.period_confidence, sv.value_numeric, sv.value_status, sv.display_es, sv.display_en, sv.unit_label, sv.source_published_at, sv.locator,
         p.key AS publication_key, p.title AS publication_title, p.expected_periodicity AS publication_periodicity, i.name AS institution_name, i.authority_class,
         pu.unit_key || '@' || pv.version AS primary_ref,
         psv.value_numeric AS primary_value_numeric, psv.value_status AS primary_value_status, psv.display_es AS primary_display_es, psv.display_en AS primary_display_en,
         psv.unit_label AS primary_unit_label, psv.period_label AS primary_period_label,
         sv.rank_position, sv.rank_of, sv.tie_group, sv.series_break_note, sv.estimated,
         row_number() OVER (PARTITION BY sv.indicator_key, sv.geo_code ORDER BY sv.period_end DESC, c.version DESC) = 1 AS is_current_period
    FROM kl.v_consumable c
    JOIN kl.stat_value sv ON sv.unit_version_id = c.unit_version_id
    JOIN kl.indicator ind ON ind.key = sv.indicator_key AND ind.consumable AND ind.nature = 'objective'
    JOIN kl.publication p ON p.id = sv.publication_id AND p.status = 'approved'
    JOIN kl.institution i ON i.id = p.institution_id
    LEFT JOIN kl.unit_version pv ON pv.id = sv.primary_unit_version_id
    LEFT JOIN kl.unit pu ON pu.id = pv.unit_id
    LEFT JOIN kl.stat_value psv ON psv.unit_version_id = sv.primary_unit_version_id
   WHERE c.kind = 'statistic'
)
SELECT s.*, (s.is_current_period AND s.next_review_at IS NOT NULL AND s.next_review_at < now()) AS latest_available FROM s;

CREATE VIEW kl.v_consumable_card AS
SELECT c.*, cc.card_type, cc.title_es, cc.body_es, cc.claims_es, cc.cites, cc.norm_published_at, cc.norm_effective_from, cc.last_reviewed_at,
       CASE WHEN lv.status = 'approved' THEN lv.title END AS title_en,
       CASE WHEN lv.status = 'approved' THEN lv.body END AS body_en,
       CASE WHEN lv.status = 'approved' THEN lv.claims END AS claims_en,
       coalesce(lv.status, 'requires_translation') AS variant_en_status,
       p.key AS publication_key, p.title AS publication_title, i.name AS institution_name, i.authority_class
  FROM kl.v_consumable c
  JOIN kl.card_content cc ON cc.unit_version_id = c.unit_version_id
  LEFT JOIN kl.card_locale_variant lv ON lv.unit_version_id = c.unit_version_id AND lv.locale = 'en'
  LEFT JOIN kl.publication p ON p.id = cc.primary_source_publication_id AND p.status = 'approved'
  LEFT JOIN kl.institution i ON i.id = p.institution_id
 WHERE c.kind = 'card'
   AND (cc.primary_source_publication_id IS NULL OR p.id IS NOT NULL);

CREATE VIEW kl.v_consumable_package AS
SELECT cp.package_key, cp.version, cp.package_key || '@' || cp.version AS package_ref, cp.level, cp.scope, cp.manifest, cp.hash, cp.estimated_tokens, cp.created_at
  FROM kl.context_package cp WHERE cp.status = 'active';

CREATE VIEW kl.v_package_status AS
SELECT cp.package_key || '@' || cp.version AS package_ref, CASE WHEN cp.status = 'active' THEN 'valid' ELSE 'invalidated' END AS status FROM kl.context_package cp;

CREATE VIEW kl.v_edition_current AS
SELECT pr.key AS product_key, pr.country, e.code, pr.key || '@' || e.code AS edition_ref, e.cutoff_date, e.published_at, e.manifest
  FROM kl.edition e JOIN kl.product pr ON pr.id = e.product_id WHERE e.status = 'published';

-- Banderas de lectura para Precision: solo la compuerta de afirmaciones aprobadas (CR-KL-001).
CREATE VIEW kl.v_flags AS
SELECT kl.r10_claims_enabled() AS r10_claims_enabled;

-- Lista de salida derivada de las publicaciones aprobadas (la exporta Plataforma al firewall; CR-KL-002 §11).
CREATE VIEW kl.v_egress_allowlist AS
SELECT DISTINCT lower(split_part(substring(official_url FROM '^https://([^/]+)'), ':', 1)) AS fqdn FROM kl.publication WHERE status = 'approved';

-- ---------------------------------------------------------------------------------------------------------------
-- Lectura de administración: solo con una certificación de la transacción en curso y permiso kl.read.
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW kl.v_admin_principals AS
SELECT principal_id, kind, auth_identity, active, first_seen_at, last_attested_at, last_reconciled_at, deactivated_at, deactivation_source FROM kl.principal WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_role_grants AS
SELECT grant_id, admin_user_id, role, editorial, domains, granted_by, granted_at, revoked_at, revoked_by FROM kl.role_grant WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_jobs AS
SELECT job_id, kind, status, run_after, lease_until, attempts, max_attempts, requested_by, error_code, created_at, updated_at FROM kl.job WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_audit AS
SELECT event_id, at, actor_principal_id, request_id, action, entity, entity_id, from_status, to_status, reason FROM kl.audit_event WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_publications AS
SELECT p.id, p.key, i.key AS institution_key, i.kind AS institution_kind, i.authority_class, p.title, p.status, p.permitted_use, p.default_content_risk, p.check_frequency, p.next_check_at, p.matrix_code
  FROM kl.publication p JOIN kl.institution i ON i.id = p.institution_id WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_unit_versions AS
SELECT uv.id AS unit_version_id, u.unit_key, u.kind, u.content_risk, uv.version, uv.status, uv.review_level, uv.requires_review, uv.origin, uv.authored_by, uv.approved_by, uv.valid_from, uv.valid_to, uv.next_review_at
  FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_batches AS
SELECT id, origin, publication_id, edition_label, status, reject_reason, uploaded_by, reviewed_by, approved_by, created_at FROM kl.ingest_batch WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_demand_groups AS
SELECT id, group_key, destination_country, region, topic, category_key, service_id, information_type, first_seen, last_seen, signal_count, distinct_projects, status FROM kl.demand_group WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_packages AS
SELECT id, package_key, version, level, hash, estimated_tokens, budget_tokens, status, invalidated_reason, created_at FROM kl.context_package WHERE (SELECT kl.can_read());

-- ---------------------------------------------------------------------------------------------------------------
-- Permisos (CR-KL-002 §8.1). El patrón es: nada para PUBLIC, solo lo que cada rol necesita.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION kl.r10_claims_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION kl._invalidate_packages(uuid[], text), kl._withdraw_versions(uuid[], text), kl._publish_version(uuid, uuid), kl._text_array(jsonb), kl._setting(text) FROM PUBLIC;

-- kl_app · funciones de administración (cada una exige certificación y permiso) y vistas de lectura de administración.
-- El permiso EXECUTE de las funciones que usa una vista se comprueba contra quien consulta, no contra el dueño de la vista.
GRANT EXECUTE ON FUNCTION kl.can_read() TO kl_app;
GRANT EXECUTE ON FUNCTION
  kl.propose_institution(text, text, text, text, text),
  kl.propose_publication(text, text, text, text, text[], text, text, text, text, text, text, text),
  kl.register_indicator(text, text, text, text, text, text, text, boolean),
  kl.decide_publication(text, text, text),
  kl.add_source_exception(text, text, text, text, timestamptz),
  kl.create_unit(text, text, text, text, text, text[], text[], text[], text, text),
  kl.create_version(text, text, uuid, text, text, text[], text[], timestamptz, timestamptz, timestamptz, boolean, text, jsonb, jsonb),
  kl.submit_version(uuid), kl.approve_version(uuid, text), kl.reject_version(uuid, text), kl.withdraw_unit(text, text), kl.approve_variant(uuid, text),
  kl.register_validator(text, uuid, text, text, text[], text),
  kl.record_validation(uuid, uuid, text, text, text, text, uuid, timestamptz, timestamptz),
  kl.register_file_object(text, text, bigint, text, text, text), kl.reject_upload(text, text, text, text),
  kl.create_ingest_batch(text, text, text, date, text, text, uuid), kl.release_awaiting_batches(text),
  kl.add_extracted_rows(uuid, jsonb), kl.set_qa_report(uuid, jsonb, integer), kl.remap_extracted_row(uuid, text, text, text),
  kl.review_batch(uuid, boolean, text), kl.publish_batch(uuid, text),
  kl.set_r10_claims(boolean, text), kl.set_setting(text, jsonb, text)
TO kl_app;
GRANT SELECT ON kl.v_admin_principals, kl.v_admin_role_grants, kl.v_admin_jobs, kl.v_admin_audit, kl.v_admin_publications, kl.v_admin_unit_versions,
  kl.v_admin_batches, kl.v_admin_demand_groups, kl.v_admin_packages TO kl_app;

-- kl_reader_precision · solo vistas publicadas y las funciones de señales.
GRANT SELECT ON kl.v_consumable, kl.v_consumable_stat, kl.v_consumable_card, kl.v_consumable_package, kl.v_package_status, kl.v_edition_current, kl.v_flags TO kl_reader_precision;
GRANT EXECUTE ON FUNCTION kl.r10_claims_enabled(), kl.record_signal(jsonb, integer), kl.record_usage(jsonb), kl.record_distribution(text, text), kl.edition_public_status(text) TO kl_reader_precision;

-- kl_knowledge · compila RAM; lee lo publicado.
GRANT SELECT ON kl.v_consumable, kl.v_consumable_stat, kl.v_consumable_card, kl.v_consumable_package TO kl_knowledge;
GRANT EXECUTE ON FUNCTION kl.compile_package(text, text, jsonb, uuid[], integer, integer), kl.expire_due_versions() TO kl_knowledge;

-- kl_agent · el recolector (R2) solo conoce los dominios aprobados; sin funciones de contenido en R1.
GRANT SELECT ON kl.v_egress_allowlist TO kl_agent;

SELECT kl.attach_guards();
