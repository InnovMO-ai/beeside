CREATE TYPE "public"."fa_access_token_kind" AS ENUM('SESSION', 'RESUME');--> statement-breakpoint
CREATE TYPE "public"."fa_extension_reason" AS ENUM('MISSING_INFORMATION', 'PROJECT_NOT_STRUCTURED', 'UNSURE_MARKET_TIMING', 'SOMETHING_ELSE');--> statement-breakpoint
CREATE TYPE "public"."legal_document" AS ENUM('PRIVACY_POLICY', 'TERMS');--> statement-breakpoint
CREATE TABLE "fa_access_extension" (
	"extension_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_days" smallint NOT NULL,
	"reason" "fa_extension_reason" NOT NULL,
	"previous_expires_at" timestamp with time zone NOT NULL,
	"new_expires_at" timestamp with time zone NOT NULL,
	"was_expired" boolean NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa_access_extension_days" CHECK ("fa_access_extension"."requested_days" IN (15, 30))
);
--> statement-breakpoint
CREATE TABLE "fa_journey_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_occurred_at" timestamp with time zone,
	"anonymous_session_id" uuid,
	"project_id" uuid,
	"step_id" text,
	"question_id" text,
	"field_key" text,
	"question_bank_version" text,
	"interface_language" text,
	"duration_ms" integer,
	"value_state" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "fa_journey_event_type_format" CHECK ("fa_journey_event"."event_type" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "fa_journey_event_value_state" CHECK ("fa_journey_event"."value_state" IS NULL OR "fa_journey_event"."value_state" IN ('answered', 'not_sure', 'cleared')),
	CONSTRAINT "fa_journey_event_duration" CHECK ("fa_journey_event"."duration_ms" IS NULL OR "fa_journey_event"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fa_project_lifecycle" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"identity_completed_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"last_answered_question_id" text,
	"access_window_started_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"access_max_until" timestamp with time zone,
	"retention_until" timestamp with time zone,
	"reminder_day10_sent_at" timestamp with time zone,
	"recovery_email_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa_project_lifecycle_access_window_consistency" CHECK (("fa_project_lifecycle"."access_window_started_at" IS NULL AND "fa_project_lifecycle"."access_expires_at" IS NULL AND "fa_project_lifecycle"."access_max_until" IS NULL AND "fa_project_lifecycle"."retention_until" IS NULL)
       OR ("fa_project_lifecycle"."access_window_started_at" IS NOT NULL AND "fa_project_lifecycle"."access_expires_at" IS NOT NULL AND "fa_project_lifecycle"."access_max_until" IS NOT NULL AND "fa_project_lifecycle"."retention_until" IS NOT NULL
           AND "fa_project_lifecycle"."access_expires_at" <= "fa_project_lifecycle"."access_max_until" AND "fa_project_lifecycle"."access_max_until" <= "fa_project_lifecycle"."retention_until"))
);
--> statement-breakpoint
CREATE TABLE "legal_acceptance" (
	"acceptance_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document" "legal_document" NOT NULL,
	"document_url" text,
	"interface_language" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_access_token" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "fa_access_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "email_domain" text;--> statement-breakpoint
ALTER TABLE "fa_access_extension" ADD CONSTRAINT "fa_access_extension_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_journey_event" ADD CONSTRAINT "fa_journey_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_project_lifecycle" ADD CONSTRAINT "fa_project_lifecycle_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_token" ADD CONSTRAINT "project_access_token_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fa_access_extension_project_idx" ON "fa_access_extension" USING btree ("project_id","requested_at");--> statement-breakpoint
CREATE INDEX "fa_journey_event_project_idx" ON "fa_journey_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fa_journey_event_type_idx" ON "fa_journey_event" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "fa_journey_event_anonymous_idx" ON "fa_journey_event" USING btree ("anonymous_session_id");--> statement-breakpoint
CREATE INDEX "fa_project_lifecycle_access_expires_idx" ON "fa_project_lifecycle" USING btree ("access_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptance_project_document_unique" ON "legal_acceptance" USING btree ("project_id","document");--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_token_hash_unique" ON "project_access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "project_access_token_project_kind_idx" ON "project_access_token" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "company_normalized_name_idx" ON "company" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "company_email_domain_idx" ON "company" USING btree ("email_domain");