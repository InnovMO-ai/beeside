-- Macroblock 4 — Precision Assessment persistence layer (schema migration; hand-authored with
-- `drizzle-kit generate`'s own conventions since this sandbox cannot run drizzle-kit against a
-- live DATABASE_URL — see the Macroblock 4 completion report for the required follow-up:
-- `npm run db:generate`/`db:check` once in an environment where `npm install` succeeds, to let
-- drizzle-kit backfill db/migrations/meta/0015_snapshot.json and confirm zero drift against
-- backend/db/schema/precision.ts and the project.ts split_from_project_id addition).
--
-- Canonical shapes: precision-block2-macroblock2-canonical-data-model-manifest-architecture-
-- 2026-10-02.md, through Freeze Patch #3 (§33). See backend/db/schema/precision.ts for the
-- section-by-section mapping; this migration is its direct DDL counterpart.

CREATE TYPE "public"."precision_instance_scope" AS ENUM('project', 'category');--> statement-breakpoint
CREATE TYPE "public"."pa_status" AS ENUM('not_started', 'in_progress', 'ready_for_confirmation', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."category_status" AS ENUM('proposed', 'not_selected', 'confirmed', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."category_origin" AS ENUM('pa_detected', 'client_added');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('precision_assessment', 'category');--> statement-breakpoint
CREATE TYPE "public"."fact_provenance_stage" AS ENUM('ai_extracted', 'client_answered', 'client_confirmed', 'client_corrected', 'system_derived');--> statement-breakpoint
CREATE TYPE "public"."fact_answer_state" AS ENUM('NOT_ASKED', 'UNKNOWN', 'WITHHELD', 'EXPLICIT_NO', 'ZERO', 'ANSWERED');--> statement-breakpoint

CREATE TABLE "precision_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" "precision_instance_scope" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_client_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "project_manifest_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" "config_version_status" DEFAULT 'DRAFT' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_admin_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_admin_user_id" uuid,
	CONSTRAINT "project_manifest_version_version_unique" UNIQUE("version"),
	CONSTRAINT "project_manifest_version_content_object" CHECK (jsonb_typeof("project_manifest_version"."content") = 'object'),
	CONSTRAINT "project_manifest_version_current_requires_published" CHECK ("project_manifest_version"."is_current" = false OR "project_manifest_version"."status" = 'PUBLISHED'),
	CONSTRAINT "project_manifest_version_published_complete" CHECK (("project_manifest_version"."status" = 'PUBLISHED') = ("project_manifest_version"."published_at" IS NOT NULL AND "project_manifest_version"."published_by_admin_user_id" IS NOT NULL))
);--> statement-breakpoint

CREATE TABLE "category_manifest_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_key" text NOT NULL,
	"version" text NOT NULL,
	"status" "config_version_status" DEFAULT 'DRAFT' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_admin_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_admin_user_id" uuid,
	CONSTRAINT "category_manifest_version_category_key_format" CHECK ("category_manifest_version"."category_key" ~ '^[a-z][a-z0-9_]{1,63}$'),
	CONSTRAINT "category_manifest_version_content_object" CHECK (jsonb_typeof("category_manifest_version"."content") = 'object'),
	CONSTRAINT "category_manifest_version_current_requires_published" CHECK ("category_manifest_version"."is_current" = false OR "category_manifest_version"."status" = 'PUBLISHED'),
	CONSTRAINT "category_manifest_version_published_complete" CHECK (("category_manifest_version"."status" = 'PUBLISHED') = ("category_manifest_version"."published_at" IS NOT NULL AND "category_manifest_version"."published_by_admin_user_id" IS NOT NULL))
);--> statement-breakpoint
-- Composite unique index, created here (before the tables that FK against it) so it is available
-- as the composite foreign-key target for category_assessment(category_key, manifest_version) below.
CREATE UNIQUE INDEX "category_manifest_version_category_version_unique" ON "category_manifest_version" USING btree ("category_key","version");--> statement-breakpoint

CREATE TABLE "precision_assessment" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"lifecycle_status" "pa_status" DEFAULT 'not_started' NOT NULL,
	"manifest_version" text NOT NULL,
	"service_map_snapshot_id" uuid,
	"split_recommendation" jsonb,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "category_assessment" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"category_key" text NOT NULL,
	"lifecycle_status" "category_status" DEFAULT 'proposed' NOT NULL,
	"manifest_version" text NOT NULL,
	"category_origin" "category_origin" NOT NULL,
	"current_pack_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_assessment_category_key_format" CHECK ("category_assessment"."category_key" ~ '^[a-z][a-z0-9_]{1,63}$')
);--> statement-breakpoint

CREATE TABLE "fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope_instance_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"answer_state" "fact_answer_state" NOT NULL,
	"source" "fact_source" NOT NULL,
	"provenance_stage" "fact_provenance_stage" NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid,
	CONSTRAINT "fact_field_key_format" CHECK ("fact"."field_key" ~ '^precision\.[a-z][a-z0-9_.]{2,80}$'),
	CONSTRAINT "fact_confidence_only_when_ai_extracted" CHECK ("fact"."provenance_stage" = 'ai_extracted' OR "fact"."confidence" IS NULL),
	CONSTRAINT "fact_confidence_range" CHECK ("fact"."confidence" IS NULL OR ("fact"."confidence" >= 0 AND "fact"."confidence" <= 1))
);--> statement-breakpoint

CREATE TABLE "service_map_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"precision_instance_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "service_map_snapshot_content_object" CHECK (jsonb_typeof("service_map_snapshot"."content") = 'object')
);--> statement-breakpoint

CREATE TABLE "pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_assessment_instance_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" jsonb NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	CONSTRAINT "pack_content_object" CHECK (jsonb_typeof("pack"."content") = 'object'),
	CONSTRAINT "pack_context_snapshot_object" CHECK (jsonb_typeof("pack"."context_snapshot") = 'object')
);--> statement-breakpoint

-- project.split_from_project_id (Macroblock 2 §3A) — column only, not the split workflow.
ALTER TABLE "project" ADD COLUMN "split_from_project_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_split_from_not_self" CHECK ("project"."split_from_project_id" IS NULL OR "project"."split_from_project_id" <> "project"."project_id");--> statement-breakpoint

-- =========================================================================
-- Foreign keys (separate ALTER TABLE statements, matching this repo's existing generated style)
-- =========================================================================
ALTER TABLE "precision_instance" ADD CONSTRAINT "precision_instance_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manifest_version" ADD CONSTRAINT "project_manifest_version_created_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manifest_version" ADD CONSTRAINT "project_manifest_version_published_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_manifest_version" ADD CONSTRAINT "category_manifest_version_created_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_manifest_version" ADD CONSTRAINT "category_manifest_version_published_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_assessment" ADD CONSTRAINT "precision_assessment_instance_id_precision_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."precision_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_assessment" ADD CONSTRAINT "precision_assessment_manifest_version_project_manifest_version_version_fk" FOREIGN KEY ("manifest_version") REFERENCES "public"."project_manifest_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_assessment" ADD CONSTRAINT "precision_assessment_service_map_snapshot_id_service_map_snapshot_id_fk" FOREIGN KEY ("service_map_snapshot_id") REFERENCES "public"."service_map_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_instance_id_precision_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."precision_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_current_pack_id_pack_id_fk" FOREIGN KEY ("current_pack_id") REFERENCES "public"."pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assessment" ADD CONSTRAINT "category_assessment_manifest_version_fk" FOREIGN KEY ("category_key","manifest_version") REFERENCES "public"."category_manifest_version"("category_key","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_scope_instance_id_precision_instance_id_fk" FOREIGN KEY ("scope_instance_id") REFERENCES "public"."precision_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_map_snapshot" ADD CONSTRAINT "service_map_snapshot_precision_instance_id_precision_instance_id_fk" FOREIGN KEY ("precision_instance_id") REFERENCES "public"."precision_instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack" ADD CONSTRAINT "pack_category_assessment_instance_id_category_assessment_instance_id_fk" FOREIGN KEY ("category_assessment_instance_id") REFERENCES "public"."category_assessment"("instance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_split_from_project_id_project_project_id_fk" FOREIGN KEY ("split_from_project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- =========================================================================
-- Indexes
-- =========================================================================
CREATE INDEX "precision_instance_project_id_idx" ON "precision_instance" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "precision_instance_one_pa_per_project" ON "precision_instance" USING btree ("project_id") WHERE "precision_instance"."scope" = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX "category_assessment_project_category_unique" ON "category_assessment" USING btree ("project_id","category_key");--> statement-breakpoint
CREATE INDEX "category_assessment_project_id_idx" ON "category_assessment" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_current_value_idx" ON "fact" USING btree ("scope_instance_id","field_key") WHERE "fact"."superseded_by" IS NULL;--> statement-breakpoint
CREATE INDEX "fact_history_idx" ON "fact" USING btree ("scope_instance_id","field_key","created_at" DESC);--> statement-breakpoint
CREATE INDEX "fact_superseded_by_idx" ON "fact" USING btree ("superseded_by");--> statement-breakpoint
CREATE INDEX "fact_project_id_idx" ON "fact" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_manifest_version_one_current" ON "project_manifest_version" USING btree ("is_current") WHERE "project_manifest_version"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "category_manifest_version_one_current_per_category" ON "category_manifest_version" USING btree ("category_key") WHERE "category_manifest_version"."is_current" = true;--> statement-breakpoint
CREATE INDEX "category_manifest_version_category_key_idx" ON "category_manifest_version" USING btree ("category_key");--> statement-breakpoint
CREATE UNIQUE INDEX "service_map_snapshot_instance_version_unique" ON "service_map_snapshot" USING btree ("precision_instance_id","version");--> statement-breakpoint
CREATE INDEX "service_map_snapshot_instance_idx" ON "service_map_snapshot" USING btree ("precision_instance_id","confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_instance_version_unique" ON "pack" USING btree ("category_assessment_instance_id","version");--> statement-breakpoint
CREATE INDEX "pack_instance_idx" ON "pack" USING btree ("category_assessment_instance_id","generated_at");--> statement-breakpoint
CREATE INDEX "project_split_from_project_id_idx" ON "project" USING btree ("split_from_project_id");
