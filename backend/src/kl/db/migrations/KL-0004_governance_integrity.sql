-- KL-0004 · Integridad y permisos de R2: vistas de administración, grants por rol y guardas del reporte de correlación.

CREATE TRIGGER kl_b_append_only BEFORE UPDATE OR DELETE ON kl.audit_correlation_report FOR EACH ROW EXECUTE FUNCTION kl.guard_append_only();

CREATE VIEW kl.v_admin_products AS
SELECT p.id, p.key, p.country, p.review_periodicity, p.next_cycle_at FROM kl.product p WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_validators AS
SELECT v.id, v.kind, v.admin_user_id, v.display_name, v.organization, v.domains, v.status, v.registered_by, v.created_at FROM kl.validator v WHERE (SELECT kl.can_read());

CREATE VIEW kl.v_admin_validation_queue AS
SELECT uv.id AS unit_version_id, u.unit_key, uv.version, uv.specialist_category_key AS domain, u.content_risk, uv.approved_at
  FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id
 WHERE uv.status = 'awaiting_validation' AND kl.queue_visible(uv.specialist_category_key);

CREATE VIEW kl.v_admin_audit_correlation AS
SELECT report_id, run_at, window_from, window_to, kl_events_checked, platform_events_checked, status, kl_only, admin_only FROM kl.audit_correlation_report WHERE (SELECT kl.can_read());

-- La periodicidad efectiva se muestra junto a cada fuente (vista nueva: v_admin_publications no se toca).
CREATE VIEW kl.v_admin_publication_schedule AS
SELECT p.id, p.key, p.status, p.check_frequency, kl.effective_check_frequency(p.id) AS effective_check_frequency, p.next_check_at
  FROM kl.publication p WHERE (SELECT kl.can_read());

-- Permisos: el permiso EXECUTE de las funciones que usa una vista se comprueba contra quien consulta.
REVOKE ALL ON FUNCTION kl.next_due(timestamptz, kl.cadence), kl.effective_check_frequency(uuid), kl._enqueue(text, jsonb, uuid, timestamptz),
  kl.correlation_snapshot(timestamptz, timestamptz), kl.last_correlation_window(), kl.record_correlation_report(timestamptz, timestamptz, integer, integer, jsonb, jsonb),
  kl.queue_visible(text), kl.begin_correlation_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kl.effective_check_frequency(uuid), kl.queue_visible(text), kl.begin_correlation_run() TO kl_app;
GRANT EXECUTE ON FUNCTION kl.create_product(text, text, kl.cadence), kl.set_product_periodicity(text, kl.cadence, text), kl.set_publication_frequency(text, text, text),
  kl.set_ram_cadence(kl.cadence, text), kl.check_now(text, text, text), kl.extraordinary_edition(text, text, text), kl.set_validator_status(uuid, text, text) TO kl_app;
GRANT EXECUTE ON FUNCTION kl.correlation_snapshot(timestamptz, timestamptz), kl.last_correlation_window(), kl.record_correlation_report(timestamptz, timestamptz, integer, integer, jsonb, jsonb) TO kl_app;
GRANT EXECUTE ON FUNCTION kl.plan_due(), kl.expire_validations() TO kl_knowledge;
GRANT SELECT ON kl.v_admin_products, kl.v_admin_validators, kl.v_admin_validation_queue, kl.v_admin_audit_correlation, kl.v_admin_publication_schedule TO kl_app;

SELECT kl.attach_guards();
