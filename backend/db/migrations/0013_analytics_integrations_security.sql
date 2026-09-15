CREATE TABLE "analytics_project_profile" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"question_bank_version" text NOT NULL,
	"primary_goal" text,
	"project_stage" text,
	"entry_mode" text,
	"destination_status" text,
	"business_type" text,
	"target_markets" text[] DEFAULT '{}'::text[] NOT NULL,
	"expected_capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"operation_components" text[] DEFAULT '{}'::text[] NOT NULL,
	"signal_areas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_project_profile_entry_mode" CHECK ("analytics_project_profile"."entry_mode" IS NULL OR "analytics_project_profile"."entry_mode" IN ('new_market', 'already_operating')),
	CONSTRAINT "analytics_project_profile_enumerations" CHECK (("analytics_project_profile"."primary_goal" IS NULL OR "analytics_project_profile"."primary_goal" ~ '^[a-z0-9_]{1,64}$')
        AND ("analytics_project_profile"."project_stage" IS NULL OR "analytics_project_profile"."project_stage" ~ '^[a-z0-9_]{1,64}$')
        AND ("analytics_project_profile"."destination_status" IS NULL OR "analytics_project_profile"."destination_status" ~ '^[a-z0-9_]{1,64}$')
        AND ("analytics_project_profile"."business_type" IS NULL OR "analytics_project_profile"."business_type" ~ '^[a-z0-9_]{1,64}$'))
);
--> statement-breakpoint
CREATE TABLE "integration_delivery" (
	"delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_event_id" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"event_type" text NOT NULL,
	"project_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"adapter_name" text,
	"external_reference" text,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_delivery_status" CHECK ("integration_delivery"."status" IN ('PENDING', 'SENDING', 'DELIVERED', 'FAILED', 'DEAD', 'SKIPPED')),
	CONSTRAINT "integration_delivery_destination" CHECK ("integration_delivery"."destination" IN ('smartsuite', 'operation_hub')),
	CONSTRAINT "integration_delivery_attempts" CHECK ("integration_delivery"."attempts" >= 0 AND "integration_delivery"."max_attempts" BETWEEN 1 AND 20 AND "integration_delivery"."attempts" <= "integration_delivery"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "integration_external_ref" (
	"destination" text NOT NULL,
	"project_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_external_ref_destination_project_id_pk" PRIMARY KEY("destination","project_id"),
	CONSTRAINT "integration_external_ref_destination" CHECK ("integration_external_ref"."destination" IN ('smartsuite', 'operation_hub')),
	CONSTRAINT "integration_external_ref_external_id" CHECK (char_length("integration_external_ref"."external_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counter" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"policy" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"max_hits" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counter_bucket_key_window_start_pk" PRIMARY KEY("bucket_key","window_start"),
	CONSTRAINT "rate_limit_counter_key_format" CHECK ("rate_limit_counter"."bucket_key" ~ '^[a-z][a-z0-9_]{2,40}:[0-9a-f]{64}$'),
	CONSTRAINT "rate_limit_counter_policy_format" CHECK ("rate_limit_counter"."policy" ~ '^[a-z][a-z0-9_]{2,40}$'),
	CONSTRAINT "rate_limit_counter_hits" CHECK ("rate_limit_counter"."hits" >= 0 AND "rate_limit_counter"."max_hits" >= 1)
);
--> statement-breakpoint
CREATE TABLE "snapshot_feedback" (
	"feedback_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"usefulness" smallint NOT NULL,
	"comment" text,
	"channel" text NOT NULL,
	"interface_language" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_feedback_usefulness" CHECK ("snapshot_feedback"."usefulness" BETWEEN 1 AND 5),
	CONSTRAINT "snapshot_feedback_comment_length" CHECK ("snapshot_feedback"."comment" IS NULL OR char_length("snapshot_feedback"."comment") BETWEEN 1 AND 2000),
	CONSTRAINT "snapshot_feedback_channel" CHECK ("snapshot_feedback"."channel" IN ('session', 'private_link')),
	CONSTRAINT "snapshot_feedback_language" CHECK ("snapshot_feedback"."interface_language" IN ('en', 'es')),
	CONSTRAINT "snapshot_feedback_question_version" CHECK ("snapshot_feedback"."question_version" ~ '^[a-z0-9][a-z0-9.-]{2,40}$')
);
--> statement-breakpoint
ALTER TABLE "analytics_project_profile" ADD CONSTRAINT "analytics_project_profile_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_outbox_event_id_outbox_event_outbox_event_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_event"("outbox_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_delivery" ADD CONSTRAINT "integration_delivery_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_external_ref" ADD CONSTRAINT "integration_external_ref_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_feedback" ADD CONSTRAINT "snapshot_feedback_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_project_profile_completed_idx" ON "analytics_project_profile" USING btree ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_delivery_event_destination_unique" ON "integration_delivery" USING btree ("event_id","destination");--> statement-breakpoint
CREATE INDEX "integration_delivery_due_idx" ON "integration_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_delivery_project_idx" ON "integration_delivery" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_counter_expires_idx" ON "rate_limit_counter" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_counter_policy_idx" ON "rate_limit_counter" USING btree ("policy","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_feedback_project_unique" ON "snapshot_feedback" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "snapshot_feedback_submitted_idx" ON "snapshot_feedback" USING btree ("submitted_at");