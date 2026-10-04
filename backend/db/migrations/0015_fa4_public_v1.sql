CREATE TABLE "fa4_access_token" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "fa4_access_token_kind" CHECK ("fa4_access_token"."kind" IN ('SESSION','RESUME'))
);
--> statement-breakpoint
CREATE TABLE "fa4_catalog_change" (
	"change_id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"catalog_version" text
);
--> statement-breakpoint
CREATE TABLE "fa4_catalog_entity" (
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"publication_status" text NOT NULL,
	"data" jsonb NOT NULL,
	"valid_from" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa4_catalog_entity_type" CHECK ("fa4_catalog_entity"."entity_type" IN ('FRONT','CATEGORY','SERVICE','CAPABILITY','COUNTRY')),
	CONSTRAINT "fa4_catalog_entity_status" CHECK ("fa4_catalog_entity"."publication_status" IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "fa4_catalog_version" (
	"version" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fa4_continuation_request" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fa4_demand_signal" (
	"signal_id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"capability_id" text,
	"reason" text NOT NULL,
	"class" text NOT NULL,
	"sourcing_status" text,
	"triage_status" text,
	"owner" text,
	"premium_state" text NOT NULL,
	"catalog_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa4_demand_signal_class" CHECK ("fa4_demand_signal"."class" IN ('ACTIONABLE','INFORMATIONAL')),
	CONSTRAINT "fa4_demand_signal_reason" CHECK ("fa4_demand_signal"."reason" IN ('SOURCEABLE','REVIEW','DEVELOPING','NO_ACTIVE_COVERAGE','UNMAPPED_NEED','NOT_OFFERED'))
);
--> statement-breakpoint
CREATE TABLE "fa4_email_delivery" (
	"delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"template" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"provider_name" text,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa4_email_delivery_status" CHECK ("fa4_email_delivery"."status" IN ('PENDING','SENDING','SENT','FAILED','DEAD','CANCELLED')),
	CONSTRAINT "fa4_email_delivery_template" CHECK ("fa4_email_delivery"."template" IN ('fa4_resume_link','fa4_result_link'))
);
--> statement-breakpoint
CREATE TABLE "fa4_project" (
	"project_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"step_key" text NOT NULL,
	"answers" jsonb NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fa4_project_status" CHECK ("fa4_project"."status" IN ('IN_PROGRESS','DELIVERED','INELIGIBLE')),
	CONSTRAINT "fa4_project_locale" CHECK ("fa4_project"."locale" IN ('es','en'))
);
--> statement-breakpoint
CREATE TABLE "fa4_result" (
	"result_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_seq" bigserial NOT NULL,
	"project_id" uuid NOT NULL,
	"catalog_version" text NOT NULL,
	"model" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fa4_access_token" ADD CONSTRAINT "fa4_access_token_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_continuation_request" ADD CONSTRAINT "fa4_continuation_request_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_continuation_request" ADD CONSTRAINT "fa4_continuation_request_result_id_fa4_result_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."fa4_result"("result_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_demand_signal" ADD CONSTRAINT "fa4_demand_signal_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_email_delivery" ADD CONSTRAINT "fa4_email_delivery_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD CONSTRAINT "fa4_result_project_id_fa4_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."fa4_project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa4_result" ADD CONSTRAINT "fa4_result_catalog_version_fa4_catalog_version_version_fk" FOREIGN KEY ("catalog_version") REFERENCES "public"."fa4_catalog_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_access_token_hash_unique" ON "fa4_access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "fa4_access_token_project_idx" ON "fa4_access_token" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "fa4_catalog_change_entity_idx" ON "fa4_catalog_change" USING btree ("entity_type","entity_id","change_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_catalog_entity_pk" ON "fa4_catalog_entity" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "fa4_continuation_request_project_idx" ON "fa4_continuation_request" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "fa4_demand_signal_project_idx" ON "fa4_demand_signal" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "fa4_demand_signal_capability_idx" ON "fa4_demand_signal" USING btree ("destination","capability_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_email_delivery_dedupe_unique" ON "fa4_email_delivery" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "fa4_email_delivery_due_idx" ON "fa4_email_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "fa4_project_email_idx" ON "fa4_project" USING btree ("email","updated_at");--> statement-breakpoint
CREATE INDEX "fa4_result_project_idx" ON "fa4_result" USING btree ("project_id","result_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "fa4_result_seq_unique" ON "fa4_result" USING btree ("result_seq");