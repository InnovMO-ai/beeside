-- Custom SQL migration: the marketing-consent history is append-only evidence (like the legal acceptances).
--  * no UPDATE / DELETE / TRUNCATE for anyone (a change of mind is a NEW row);
--  * the runtime role cannot even UPDATE it.
CREATE TRIGGER fa4_marketing_consent_append_only BEFORE UPDATE OR DELETE ON fa4_marketing_consent
  FOR EACH ROW EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER fa4_marketing_consent_no_truncate BEFORE TRUNCATE ON fa4_marketing_consent
  FOR EACH STATEMENT EXECUTE FUNCTION fa4_append_only_guard();
--> statement-breakpoint
REVOKE UPDATE ON fa4_marketing_consent FROM beeside_runtime_role;
