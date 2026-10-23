CREATE TABLE "company_match_review" (
	"review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_company_id" uuid NOT NULL,
	"signal" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "company_match_review_signal" CHECK ("company_match_review"."signal" IN ('NORMALIZED_NAME','EMAIL_DOMAIN','NAME_AND_DOMAIN')),
	CONSTRAINT "company_match_review_status" CHECK ("company_match_review"."status" IN ('OPEN','CONFIRMED_SAME','CONFIRMED_DISTINCT')),
	CONSTRAINT "company_match_review_distinct" CHECK ("company_match_review"."company_id" <> "company_match_review"."candidate_company_id")
);
--> statement-breakpoint
CREATE TABLE "company_person" (
	"company_person_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text NOT NULL,
	"role" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_person_status" CHECK ("company_person"."status" IN ('ACTIVE','INVITED','PENDING_REVIEW','REVOKED')),
	CONSTRAINT "company_person_role" CHECK ("company_person"."role" IN ('OWNER','MEMBER'))
);
--> statement-breakpoint
CREATE TABLE "project_origin" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"discovery_result_id" uuid NOT NULL,
	"contract_version" text NOT NULL,
	"promoted_by_source" text NOT NULL,
	"identity_evidence" text NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_origin_origin" CHECK ("project_origin"."origin" IN ('DISCOVERY_FA4')),
	CONSTRAINT "project_origin_evidence" CHECK ("project_origin"."identity_evidence" IN ('email_link','payment','operator','new_person'))
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "merged_into_company_id" uuid;--> statement-breakpoint
ALTER TABLE "company_match_review" ADD CONSTRAINT "company_match_review_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_match_review" ADD CONSTRAINT "company_match_review_candidate_company_id_company_company_id_fk" FOREIGN KEY ("candidate_company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_person" ADD CONSTRAINT "company_person_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_person" ADD CONSTRAINT "company_person_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_origin" ADD CONSTRAINT "project_origin_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_origin" ADD CONSTRAINT "project_origin_discovery_result_id_fa4_result_result_id_fk" FOREIGN KEY ("discovery_result_id") REFERENCES "public"."fa4_result"("result_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_match_review_pair_unique" ON "company_match_review" USING btree ("company_id","candidate_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_person_unique" ON "company_person" USING btree ("company_id","person_id");--> statement-breakpoint
CREATE INDEX "company_person_person_idx" ON "company_person" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_merged_into_company_id_company_company_id_fk" FOREIGN KEY ("merged_into_company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_status" CHECK ("company"."status" IN ('ACTIVE','PROVISIONAL','MERGED'));--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_merged_consistency" CHECK (("company"."status" = 'MERGED') = ("company"."merged_into_company_id" IS NOT NULL));--> statement-breakpoint
-- =========================================================================
-- Discovery -> Core continuity: the permanent, entitlement-gated promotion bridge (frozen identity continuity contract, TX1).
-- A Discovery project (fa4_project) becomes a Core project under the SAME project_id ONLY when a valid entitlement is activated.
-- Tables above: company lifecycle + company_person + company_match_review (identity), project_origin (the sealed Discovery result a
-- promotion was made against). Below: the reference configuration a promoted project pins, the promotion-aware pin trigger, the
-- project_origin guards and the privacy erasure classification of the new tables.
--
-- Revert (manual; data in the new tables is lost on DROP):
--   BEGIN;
--   DROP TRIGGER IF EXISTS project_origin_insert_guard_trigger ON project_origin;
--   DROP TRIGGER IF EXISTS project_origin_append_only ON project_origin;
--   DROP FUNCTION IF EXISTS project_origin_insert_guard();
--   -- restore the 0004 body of project_pin_current_versions() (CREATE OR REPLACE from 0004)
--   DROP TABLE project_origin, company_match_review, company_person;
--   ALTER TABLE company DROP COLUMN merged_into_company_id, DROP COLUMN status;
--   DELETE FROM privacy_erasure_registry WHERE table_name IN ('company_person','company_match_review','project_origin');
--   COMMIT;  -- the fa4-public-v1 reference rows and the system actor are inert and may stay.
-- =========================================================================

-- 1. A technical actor that can never sign in (inactive, login disabled) as the publisher of the reference configuration.
INSERT INTO admin_user (role, auth_identity, active, login_enabled)
VALUES ('ADMIN', 'system:fa4-promotion', false, false)
ON CONFLICT (auth_identity) DO NOTHING;--> statement-breakpoint

-- 2. The three version pins a promoted Discovery project carries. They are inert labels (a Discovery project has no legacy FA question bank,
--    rules engine or snapshot template); they are PUBLISHED but never current, so they cannot disturb the legacy configuration lifecycle.
ALTER TABLE question_bank_version DISABLE TRIGGER question_bank_version_guard;--> statement-breakpoint
ALTER TABLE rules_engine_version DISABLE TRIGGER rules_engine_version_guard;--> statement-breakpoint
ALTER TABLE snapshot_template_version DISABLE TRIGGER snapshot_template_version_guard;--> statement-breakpoint
INSERT INTO question_bank_version (version, config, is_current, status, content_hash, change_kind, previewed_at, published_at, created_by_admin_user_id, published_by_admin_user_id)
SELECT 'fa4-public-v1', c.cfg, false, 'PUBLISHED', config_content_hash(c.cfg), 'CONTENT', now(), now(), a.admin_user_id, a.admin_user_id
  FROM admin_user a, (SELECT '{"kind":"fa4-promotion-reference","note":"Discovery (FA Public v1) owns its own question bank; this label only satisfies the Core pin."}'::jsonb AS cfg) c
 WHERE a.auth_identity = 'system:fa4-promotion'
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
INSERT INTO rules_engine_version (version, config, is_current, status, content_hash, change_kind, previewed_at, published_at, created_by_admin_user_id, published_by_admin_user_id)
SELECT 'fa4-public-v1', c.cfg, false, 'PUBLISHED', config_content_hash(c.cfg), 'CONTENT', now(), now(), a.admin_user_id, a.admin_user_id
  FROM admin_user a, (SELECT '{"kind":"fa4-promotion-reference","note":"Discovery (FA Public v1) owns its own rules; this label only satisfies the Core pin."}'::jsonb AS cfg) c
 WHERE a.auth_identity = 'system:fa4-promotion'
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
INSERT INTO snapshot_template_version (version, config, is_current, status, content_hash, change_kind, previewed_at, published_at, created_by_admin_user_id, published_by_admin_user_id)
SELECT 'fa4-public-v1', c.cfg, false, 'PUBLISHED', config_content_hash(c.cfg), 'CONTENT', now(), now(), a.admin_user_id, a.admin_user_id
  FROM admin_user a, (SELECT '{"kind":"fa4-promotion-reference","note":"Discovery (FA Public v1) owns its own result; this label only satisfies the Core pin."}'::jsonb AS cfg) c
 WHERE a.auth_identity = 'system:fa4-promotion'
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
ALTER TABLE question_bank_version ENABLE TRIGGER question_bank_version_guard;--> statement-breakpoint
ALTER TABLE rules_engine_version ENABLE TRIGGER rules_engine_version_guard;--> statement-breakpoint
ALTER TABLE snapshot_template_version ENABLE TRIGGER snapshot_template_version_guard;--> statement-breakpoint

-- 3. Pinning: unchanged for every legacy project. Inside a Discovery promotion (transaction-local flag set by the promotion function)
--    the project pins the dedicated reference label instead of the legacy "current" versions.
CREATE OR REPLACE FUNCTION project_pin_current_versions() RETURNS TRIGGER AS $$
DECLARE
  v_question_bank TEXT;
  v_rules_engine TEXT;
  v_snapshot_template TEXT;
BEGIN
  IF current_setting('app.project_origin', true) IS NOT DISTINCT FROM 'FA4_PROMOTION' THEN
    IF COALESCE(NEW.question_bank_version, 'fa4-public-v1') <> 'fa4-public-v1'
       OR COALESCE(NEW.rules_engine_version, 'fa4-public-v1') <> 'fa4-public-v1'
       OR COALESCE(NEW.snapshot_template_version, 'fa4-public-v1') <> 'fa4-public-v1' THEN
      RAISE EXCEPTION 'a Discovery promotion pins the fa4-public-v1 reference versions only' USING ERRCODE = 'BV412';
    END IF;
    NEW.question_bank_version := 'fa4-public-v1';
    NEW.rules_engine_version := 'fa4-public-v1';
    NEW.snapshot_template_version := 'fa4-public-v1';
    RETURN NEW;
  END IF;

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
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- 4. project_origin: the promotion record is only valid against a DELIVERED Discovery project and its own sealed result, and is never rewritten.
CREATE FUNCTION project_origin_insert_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fa4_project p JOIN fa4_result r ON r.project_id = p.project_id
                  WHERE p.project_id = NEW.project_id AND p.status = 'DELIVERED'
                    AND r.result_id = NEW.discovery_result_id AND NOT r.legacy_unsealed) THEN
    RAISE EXCEPTION 'project % can be promoted only from a DELIVERED Discovery project and its own sealed result', NEW.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER project_origin_insert_guard_trigger BEFORE INSERT ON project_origin
  FOR EACH ROW EXECUTE FUNCTION project_origin_insert_guard();--> statement-breakpoint
CREATE TRIGGER project_origin_append_only BEFORE UPDATE OR DELETE ON project_origin
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();--> statement-breakpoint

-- 5. Privacy erasure classification of the new tables (the registry guard test fails for an unclassified table). All three carry identifiers only;
--    the personal data they point at (person, company) is anonymised in place by the existing mechanism.
ALTER TABLE privacy_erasure_registry DISABLE TRIGGER privacy_registry_guard_trigger;--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason) VALUES
  ('company_person', 'identity', 'keep', NULL, NULL, 'membership link between ids; person and company are anonymised in place, the link carries no personal data'),
  ('company_match_review', 'identity', 'keep', NULL, NULL, 'company ids and a signal code only; company is anonymised in place'),
  ('project_origin', 'identity', 'keep', NULL, NULL, 'project id, sealed Discovery result id, contract version and entitlement source code; no personal data (the sealed result is erased by Discovery''s own mechanism)');--> statement-breakpoint
ALTER TABLE privacy_erasure_registry ENABLE TRIGGER privacy_registry_guard_trigger;
