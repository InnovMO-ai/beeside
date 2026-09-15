CREATE TYPE "public"."config_change_kind" AS ENUM('CONTENT', 'LOGIC_SCHEMA');--> statement-breakpoint
CREATE TYPE "public"."config_registry" AS ENUM('QUESTION_BANK', 'RULES_ENGINE', 'SNAPSHOT_TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."config_review_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."config_version_event_type" AS ENUM('DRAFT_CREATED', 'DRAFT_UPDATED', 'SUBMITTED_FOR_PREVIEW', 'RETURNED_TO_DRAFT', 'REVIEW_RECORDED', 'PUBLISHED', 'CURRENT_REPOINTED');--> statement-breakpoint
CREATE TYPE "public"."config_version_status" AS ENUM('DRAFT', 'PREVIEW', 'PUBLISHED');--> statement-breakpoint
CREATE TABLE "config_version_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry" "config_registry" NOT NULL,
	"question_bank_version" text,
	"rules_engine_version" text,
	"snapshot_template_version" text,
	"event_type" "config_version_event_type" NOT NULL,
	"from_status" "config_version_status",
	"to_status" "config_version_status",
	"content_hash" text,
	"actor_admin_user_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "config_version_event_registry_target" CHECK (("config_version_event"."registry" = 'QUESTION_BANK' AND "config_version_event"."question_bank_version" IS NOT NULL AND "config_version_event"."rules_engine_version" IS NULL AND "config_version_event"."snapshot_template_version" IS NULL)
     OR ("config_version_event"."registry" = 'RULES_ENGINE' AND "config_version_event"."rules_engine_version" IS NOT NULL AND "config_version_event"."question_bank_version" IS NULL AND "config_version_event"."snapshot_template_version" IS NULL)
     OR ("config_version_event"."registry" = 'SNAPSHOT_TEMPLATE' AND "config_version_event"."snapshot_template_version" IS NOT NULL AND "config_version_event"."question_bank_version" IS NULL AND "config_version_event"."rules_engine_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "config_version_review" (
	"review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry" "config_registry" NOT NULL,
	"question_bank_version" text,
	"rules_engine_version" text,
	"snapshot_template_version" text,
	"content_hash" text NOT NULL,
	"base_version" text,
	"base_content_hash" text,
	"change_kind" "config_change_kind" NOT NULL,
	"diff" jsonb NOT NULL,
	"diff_reviewed" boolean DEFAULT false NOT NULL,
	"decision" "config_review_decision" NOT NULL,
	"notes" text,
	"reviewer_admin_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "config_version_review_registry_target" CHECK (("config_version_review"."registry" = 'QUESTION_BANK' AND "config_version_review"."question_bank_version" IS NOT NULL AND "config_version_review"."rules_engine_version" IS NULL AND "config_version_review"."snapshot_template_version" IS NULL)
     OR ("config_version_review"."registry" = 'RULES_ENGINE' AND "config_version_review"."rules_engine_version" IS NOT NULL AND "config_version_review"."question_bank_version" IS NULL AND "config_version_review"."snapshot_template_version" IS NULL)
     OR ("config_version_review"."registry" = 'SNAPSHOT_TEMPLATE' AND "config_version_review"."snapshot_template_version" IS NOT NULL AND "config_version_review"."question_bank_version" IS NULL AND "config_version_review"."rules_engine_version" IS NULL)),
	CONSTRAINT "config_version_review_logic_requires_diff_review" CHECK ("config_version_review"."decision" <> 'APPROVED' OR "config_version_review"."change_kind" <> 'LOGIC_SCHEMA' OR "config_version_review"."diff_reviewed" = true)
);
--> statement-breakpoint
ALTER TABLE "question_bank_version" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "question_bank_version" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "status" "config_version_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "change_kind" "config_change_kind";--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "base_version" text;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "created_by_admin_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "previewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD COLUMN "published_by_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "status" "config_version_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "change_kind" "config_change_kind";--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "base_version" text;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "created_by_admin_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "previewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD COLUMN "published_by_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "status" "config_version_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "change_kind" "config_change_kind";--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "base_version" text;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "created_by_admin_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "previewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD COLUMN "published_by_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "config_version_event" ADD CONSTRAINT "config_version_event_question_bank_version_question_bank_version_version_fk" FOREIGN KEY ("question_bank_version") REFERENCES "public"."question_bank_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_event" ADD CONSTRAINT "config_version_event_rules_engine_version_rules_engine_version_version_fk" FOREIGN KEY ("rules_engine_version") REFERENCES "public"."rules_engine_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_event" ADD CONSTRAINT "config_version_event_snapshot_template_version_snapshot_template_version_version_fk" FOREIGN KEY ("snapshot_template_version") REFERENCES "public"."snapshot_template_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_event" ADD CONSTRAINT "config_version_event_actor_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_review" ADD CONSTRAINT "config_version_review_question_bank_version_question_bank_version_version_fk" FOREIGN KEY ("question_bank_version") REFERENCES "public"."question_bank_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_review" ADD CONSTRAINT "config_version_review_rules_engine_version_rules_engine_version_version_fk" FOREIGN KEY ("rules_engine_version") REFERENCES "public"."rules_engine_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_review" ADD CONSTRAINT "config_version_review_snapshot_template_version_snapshot_template_version_version_fk" FOREIGN KEY ("snapshot_template_version") REFERENCES "public"."snapshot_template_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_version_review" ADD CONSTRAINT "config_version_review_reviewer_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("reviewer_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "config_version_event_registry_idx" ON "config_version_event" USING btree ("registry","occurred_at");--> statement-breakpoint
CREATE INDEX "config_version_review_registry_idx" ON "config_version_review" USING btree ("registry","reviewed_at");--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_base_version_question_bank_version_version_fk" FOREIGN KEY ("base_version") REFERENCES "public"."question_bank_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_created_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_published_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_base_version_rules_engine_version_version_fk" FOREIGN KEY ("base_version") REFERENCES "public"."rules_engine_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_created_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_published_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_base_version_snapshot_template_version_version_fk" FOREIGN KEY ("base_version") REFERENCES "public"."snapshot_template_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_created_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_published_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_current_requires_published" CHECK ("question_bank_version"."is_current" = false OR "question_bank_version"."status" = 'PUBLISHED');--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_draft_clean" CHECK ("question_bank_version"."status" <> 'DRAFT' OR ("question_bank_version"."content_hash" IS NULL AND "question_bank_version"."change_kind" IS NULL AND "question_bank_version"."previewed_at" IS NULL AND "question_bank_version"."published_at" IS NULL AND "question_bank_version"."published_by_admin_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_frozen_complete" CHECK ("question_bank_version"."status" = 'DRAFT' OR ("question_bank_version"."content_hash" IS NOT NULL AND "question_bank_version"."change_kind" IS NOT NULL AND "question_bank_version"."previewed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "question_bank_version" ADD CONSTRAINT "question_bank_version_published_complete" CHECK (("question_bank_version"."status" = 'PUBLISHED') = ("question_bank_version"."published_at" IS NOT NULL AND "question_bank_version"."published_by_admin_user_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_current_requires_published" CHECK ("rules_engine_version"."is_current" = false OR "rules_engine_version"."status" = 'PUBLISHED');--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_draft_clean" CHECK ("rules_engine_version"."status" <> 'DRAFT' OR ("rules_engine_version"."content_hash" IS NULL AND "rules_engine_version"."change_kind" IS NULL AND "rules_engine_version"."previewed_at" IS NULL AND "rules_engine_version"."published_at" IS NULL AND "rules_engine_version"."published_by_admin_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_frozen_complete" CHECK ("rules_engine_version"."status" = 'DRAFT' OR ("rules_engine_version"."content_hash" IS NOT NULL AND "rules_engine_version"."change_kind" IS NOT NULL AND "rules_engine_version"."previewed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rules_engine_version" ADD CONSTRAINT "rules_engine_version_published_complete" CHECK (("rules_engine_version"."status" = 'PUBLISHED') = ("rules_engine_version"."published_at" IS NOT NULL AND "rules_engine_version"."published_by_admin_user_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_current_requires_published" CHECK ("snapshot_template_version"."is_current" = false OR "snapshot_template_version"."status" = 'PUBLISHED');--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_draft_clean" CHECK ("snapshot_template_version"."status" <> 'DRAFT' OR ("snapshot_template_version"."content_hash" IS NULL AND "snapshot_template_version"."change_kind" IS NULL AND "snapshot_template_version"."previewed_at" IS NULL AND "snapshot_template_version"."published_at" IS NULL AND "snapshot_template_version"."published_by_admin_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_frozen_complete" CHECK ("snapshot_template_version"."status" = 'DRAFT' OR ("snapshot_template_version"."content_hash" IS NOT NULL AND "snapshot_template_version"."change_kind" IS NOT NULL AND "snapshot_template_version"."previewed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "snapshot_template_version" ADD CONSTRAINT "snapshot_template_version_published_complete" CHECK (("snapshot_template_version"."status" = 'PUBLISHED') = ("snapshot_template_version"."published_at" IS NOT NULL AND "snapshot_template_version"."published_by_admin_user_id" IS NOT NULL));