CREATE TABLE "admin_audit_event" (
	"audit_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_admin_user_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"project_id" uuid,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admin_audit_event_outcome" CHECK ("admin_audit_event"."outcome" IN ('ALLOWED', 'DENIED', 'FAILED')),
	CONSTRAINT "admin_audit_event_action_format" CHECK ("admin_audit_event"."action" ~ '^[a-z][a-z0-9_.]{2,80}$'),
	CONSTRAINT "admin_audit_event_actor_consistency" CHECK (("admin_audit_event"."actor_type" = 'ADMIN_USER' AND "admin_audit_event"."actor_admin_user_id" IS NOT NULL) OR ("admin_audit_event"."actor_type" = 'SYSTEM' AND "admin_audit_event"."actor_admin_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role_at_login" "admin_role" NOT NULL,
	"auth_issuer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "admin_session_expiry_after_creation" CHECK ("admin_session"."expires_at" > "admin_session"."created_at")
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"project_id" uuid,
	"person_id" uuid NOT NULL,
	"template" text NOT NULL,
	"template_source" text NOT NULL,
	"link_kind" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enqueued_by" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"provider_name" text,
	"provider_reference" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_status" CHECK ("email_delivery"."status" IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED')),
	CONSTRAINT "email_delivery_template_format" CHECK ("email_delivery"."template" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "email_delivery_template_source" CHECK ("email_delivery"."template_source" IN ('question_bank', 'snapshot_template')),
	CONSTRAINT "email_delivery_link_kind" CHECK ("email_delivery"."link_kind" IS NULL OR "email_delivery"."link_kind" = 'RESUME'),
	CONSTRAINT "email_delivery_attempts" CHECK ("email_delivery"."attempts" >= 0 AND "email_delivery"."max_attempts" BETWEEN 1 AND 20 AND "email_delivery"."attempts" <= "email_delivery"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by_admin_user_id" uuid,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_run_status" CHECK ("job_run"."status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')),
	CONSTRAINT "job_run_trigger" CHECK ("job_run"."trigger" IN ('worker', 'cli', 'admin', 'test')),
	CONSTRAINT "job_run_name_format" CHECK ("job_run"."job_name" ~ '^[a-z][a-z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE TABLE "retention_purge_record" (
	"purge_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"job_run_id" uuid,
	"purged_at" timestamp with time zone NOT NULL,
	"previous_state" "assessment_state" NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"retention_basis" text NOT NULL,
	"purge_scope" text NOT NULL,
	"deleted_rows" jsonb NOT NULL,
	"person_anonymized" boolean NOT NULL,
	"company_anonymized" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fa_project_lifecycle" DROP CONSTRAINT "fa_project_lifecycle_access_window_consistency";--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "login_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "auth_issuer" text;--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "auth_subject" text;--> statement-breakpoint
ALTER TABLE "admin_user" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_event" ADD COLUMN "delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "email_event" ADD COLUMN "attempt" integer;--> statement-breakpoint
ALTER TABLE "fa_project_lifecycle" ADD COLUMN "retention_basis" text;--> statement-breakpoint
ALTER TABLE "fa_project_lifecycle" ADD COLUMN "access_expiry_recorded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD COLUMN "question_bank_version" text;--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_actor_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_person_id_person_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_triggered_by_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("triggered_by_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_purge_record" ADD CONSTRAINT "retention_purge_record_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_purge_record" ADD CONSTRAINT "retention_purge_record_job_run_id_job_run_run_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_event_occurred_idx" ON "admin_audit_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "admin_audit_event_actor_idx" ON "admin_audit_event" USING btree ("actor_admin_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_audit_event_project_idx" ON "admin_audit_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_session_token_hash_unique" ON "admin_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_session_admin_user_idx" ON "admin_session" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_dedupe_key_unique" ON "email_delivery" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_delivery_due_idx" ON "email_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_delivery_project_idx" ON "email_delivery" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_one_running_per_job" ON "job_run" USING btree ("job_name") WHERE "job_run"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "job_run_job_started_idx" ON "job_run" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_purge_record_project_unique" ON "retention_purge_record" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_delivery_id_email_delivery_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."email_delivery"("delivery_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_question_bank_version_question_bank_version_version_fk" FOREIGN KEY ("question_bank_version") REFERENCES "public"."question_bank_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_user_auth_subject_unique" ON "admin_user" USING btree ("auth_issuer","auth_subject") WHERE "admin_user"."auth_issuer" IS NOT NULL AND "admin_user"."auth_subject" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fa_project_lifecycle_retention_until_idx" ON "fa_project_lifecycle" USING btree ("retention_until");--> statement-breakpoint
ALTER TABLE "fa_project_lifecycle" ADD CONSTRAINT "fa_project_lifecycle_access_window_consistency" CHECK (("fa_project_lifecycle"."access_window_started_at" IS NULL AND "fa_project_lifecycle"."access_expires_at" IS NULL AND "fa_project_lifecycle"."access_max_until" IS NULL)
       OR ("fa_project_lifecycle"."access_window_started_at" IS NOT NULL AND "fa_project_lifecycle"."access_expires_at" IS NOT NULL AND "fa_project_lifecycle"."access_max_until" IS NOT NULL
           AND "fa_project_lifecycle"."access_expires_at" <= "fa_project_lifecycle"."access_max_until"));