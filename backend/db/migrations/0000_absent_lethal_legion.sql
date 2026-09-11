CREATE TYPE "public"."actor_type" AS ENUM('PERSON', 'ADMIN_USER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('ADMIN', 'SUPERVISOR');--> statement-breakpoint
CREATE TYPE "public"."assessment_state" AS ENUM('DRAFT', 'IN_PROGRESS', 'COMPLETED_LOCKED', 'EXPIRED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('DEFINED', 'NEEDS_ATTENTION', 'CRITICAL_GAP', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."precision_state" AS ENUM('NOT_STARTED', 'STARTED');--> statement-breakpoint
CREATE TYPE "public"."priority_alignment_status" AS ENUM('ALIGNED', 'TENSION_DETECTED');--> statement-breakpoint
CREATE TYPE "public"."signal_strength" AS ENUM('STRONG', 'SUPPORTING', 'POSSIBLE', 'NO_SIGNAL');--> statement-breakpoint
CREATE TYPE "public"."subscription_event_type" AS ENUM('premium_activated', 'cancellation_requested', 'subscription_period_ended', 'premium_reactivated');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('PREMIUM_ACTIVE', 'CANCELLATION_SCHEDULED', 'PREMIUM_INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."trust_state" AS ENUM('NORMAL', 'REVIEW', 'BLOCK');--> statement-breakpoint
CREATE TABLE "capability_taxonomy_category" (
	"category_id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "country" (
	"country_code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_key_registry" (
	"field_key" text PRIMARY KEY NOT NULL,
	"data_type" text NOT NULL,
	"source" text NOT NULL,
	"module" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "question_bank_version" (
	"version" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_engine_version" (
	"version" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_matrix_category" (
	"category_id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" smallint NOT NULL,
	"is_finding_area" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_template_version" (
	"version" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"company_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"normalized_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"person_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"primary_email" text NOT NULL,
	"interface_language" text NOT NULL,
	"preferred_interaction_language" text NOT NULL,
	"preferred_deliverable_language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"project_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"responsible_person_id" uuid NOT NULL,
	"assessment_state" "assessment_state" DEFAULT 'DRAFT' NOT NULL,
	"trust_state" "trust_state" DEFAULT 'NORMAL' NOT NULL,
	"last_completed_step" text,
	"question_bank_version" text NOT NULL,
	"rules_engine_version" text NOT NULL,
	"snapshot_template_version" text NOT NULL,
	"extension_requested" boolean DEFAULT false NOT NULL,
	"premium_ever_activated" boolean DEFAULT false NOT NULL,
	"premium_first_activated_at" timestamp with time zone,
	"precision_state" "precision_state" DEFAULT 'NOT_STARTED' NOT NULL,
	"precision_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_premium_first_activated_consistency" CHECK ("project"."premium_first_activated_at" IS NULL OR "project"."premium_ever_activated" = true),
	CONSTRAINT "project_precision_started_consistency" CHECK ("project"."precision_started_at" IS NULL OR "project"."precision_state" = 'STARTED')
);
--> statement-breakpoint
CREATE TABLE "project_responsibility_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"previous_responsible_person_id" uuid,
	"new_responsible_person_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_person_id" uuid,
	"actor_admin_user_id" uuid,
	CONSTRAINT "project_responsibility_change_actor_consistency" CHECK (("project_responsibility_change"."actor_type" = 'PERSON' AND "project_responsibility_change"."actor_person_id" IS NOT NULL AND "project_responsibility_change"."actor_admin_user_id" IS NULL)
       OR ("project_responsibility_change"."actor_type" = 'ADMIN_USER' AND "project_responsibility_change"."actor_admin_user_id" IS NOT NULL AND "project_responsibility_change"."actor_person_id" IS NULL)
       OR ("project_responsibility_change"."actor_type" = 'SYSTEM' AND "project_responsibility_change"."actor_person_id" IS NULL AND "project_responsibility_change"."actor_admin_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "answer" (
	"answer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question_bank_version" text NOT NULL,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_rank" (
	"project_id" uuid NOT NULL,
	"category_id" smallint NOT NULL,
	"rank" smallint NOT NULL,
	"included_in_snapshot" boolean DEFAULT false NOT NULL,
	"rules_engine_version" text NOT NULL,
	CONSTRAINT "capability_rank_project_id_category_id_pk" PRIMARY KEY("project_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"finding_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"area_id" smallint NOT NULL,
	"status" "finding_status" NOT NULL,
	"signal_strength" "signal_strength" DEFAULT 'NO_SIGNAL' NOT NULL,
	"internal_signal" text,
	"reason_client" text NOT NULL,
	"evidence_field_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_assessment" (
	"internal_assessment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rules_engine_version" text NOT NULL,
	"snapshot_template_version" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "internal_assessment_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "precision_handoff_package" (
	"package_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "precision_handoff_package_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "priority_alignment" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"alignment" "priority_alignment_status" NOT NULL,
	"tension_area_id" smallint,
	"tension_reason" text,
	"rules_engine_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rules_engine_version" text NOT NULL,
	"snapshot_template_version" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "snapshot_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_state_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_state" "assessment_state",
	"to_state" "assessment_state" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_state_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subscription_id" uuid,
	"from_state" "subscription_status",
	"to_state" "subscription_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"premium_access_active" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_hub_link" (
	"project_id" uuid NOT NULL,
	"external_system" text NOT NULL,
	"external_workspace_id" text,
	"external_record_id" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_hub_link_project_id_external_system_pk" PRIMARY KEY("project_id","external_system")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"subscription_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"project_id" uuid NOT NULL,
	"event_type" "subscription_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text,
	"provider_reference" text
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"admin_user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "admin_role" NOT NULL,
	"auth_identity" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_auth_identity_unique" UNIQUE("auth_identity")
);
--> statement-breakpoint
CREATE TABLE "email_event" (
	"email_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"email_type" text NOT NULL,
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"provider_reference" text
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"outbox_event_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_event_outbox_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relayed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_company_id_company_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_person_id_person_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_responsible_person_id_person_person_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_question_bank_version_question_bank_version_version_fk" FOREIGN KEY ("question_bank_version") REFERENCES "public"."question_bank_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_rules_engine_version_rules_engine_version_version_fk" FOREIGN KEY ("rules_engine_version") REFERENCES "public"."rules_engine_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_snapshot_template_version_snapshot_template_version_version_fk" FOREIGN KEY ("snapshot_template_version") REFERENCES "public"."snapshot_template_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_responsibility_change" ADD CONSTRAINT "project_responsibility_change_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_responsibility_change" ADD CONSTRAINT "project_responsibility_change_previous_responsible_person_id_person_person_id_fk" FOREIGN KEY ("previous_responsible_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_responsibility_change" ADD CONSTRAINT "project_responsibility_change_new_responsible_person_id_person_person_id_fk" FOREIGN KEY ("new_responsible_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_responsibility_change" ADD CONSTRAINT "project_responsibility_change_actor_person_id_person_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_responsibility_change" ADD CONSTRAINT "project_responsibility_change_actor_admin_user_id_admin_user_admin_user_id_fk" FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_user"("admin_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_field_key_field_key_registry_field_key_fk" FOREIGN KEY ("field_key") REFERENCES "public"."field_key_registry"("field_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_rank" ADD CONSTRAINT "capability_rank_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_rank" ADD CONSTRAINT "capability_rank_category_id_capability_taxonomy_category_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."capability_taxonomy_category"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_area_id_rules_matrix_category_category_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."rules_matrix_category"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_assessment" ADD CONSTRAINT "internal_assessment_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precision_handoff_package" ADD CONSTRAINT "precision_handoff_package_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_alignment" ADD CONSTRAINT "priority_alignment_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_alignment" ADD CONSTRAINT "priority_alignment_tension_area_id_rules_matrix_category_category_id_fk" FOREIGN KEY ("tension_area_id") REFERENCES "public"."rules_matrix_category"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_state_transition" ADD CONSTRAINT "assessment_state_transition_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_state_transition" ADD CONSTRAINT "subscription_state_transition_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_state_transition" ADD CONSTRAINT "subscription_state_transition_subscription_id_subscription_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("subscription_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_hub_link" ADD CONSTRAINT "operation_hub_link_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_subscription_id_subscription_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("subscription_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_bank_version_one_current" ON "question_bank_version" USING btree ("is_current") WHERE "question_bank_version"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_engine_version_one_current" ON "rules_engine_version" USING btree ("is_current") WHERE "rules_engine_version"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_template_version_one_current" ON "snapshot_template_version" USING btree ("is_current") WHERE "snapshot_template_version"."is_current" = true;--> statement-breakpoint
CREATE INDEX "company_normalized_domain_idx" ON "company" USING btree ("normalized_domain");--> statement-breakpoint
CREATE INDEX "company_name_idx" ON "company" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "person_primary_email_unique" ON "person" USING btree ("primary_email");--> statement-breakpoint
CREATE INDEX "project_company_id_idx" ON "project" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "project_assessment_state_idx" ON "project" USING btree ("assessment_state");--> statement-breakpoint
CREATE INDEX "project_assessment_state_premium_idx" ON "project" USING btree ("assessment_state","premium_ever_activated");--> statement-breakpoint
CREATE INDEX "project_responsibility_change_project_idx" ON "project_responsibility_change" USING btree ("project_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_current_value_idx" ON "answer" USING btree ("project_id","field_key") WHERE "answer"."superseded_by" IS NULL;--> statement-breakpoint
CREATE INDEX "answer_history_idx" ON "answer" USING btree ("project_id","field_key","answered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "answer_superseded_by_idx" ON "answer" USING btree ("superseded_by");--> statement-breakpoint
CREATE INDEX "capability_rank_project_rank_idx" ON "capability_rank" USING btree ("project_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_project_area_unique" ON "finding" USING btree ("project_id","area_id");--> statement-breakpoint
CREATE INDEX "assessment_state_transition_project_idx" ON "assessment_state_transition" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "subscription_state_transition_project_idx" ON "subscription_state_transition" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_one_active_per_project" ON "subscription" USING btree ("project_id") WHERE "subscription"."status" = 'PREMIUM_ACTIVE';--> statement-breakpoint
CREATE INDEX "subscription_project_status_idx" ON "subscription" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "subscription_event_project_idx" ON "subscription_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "subscription_event_subscription_idx" ON "subscription_event" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "email_event_cooldown_idx" ON "email_event" USING btree ("project_id","email_type","sent_at");--> statement-breakpoint
CREATE INDEX "outbox_event_occurred_at_idx" ON "outbox_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("relayed_at") WHERE "outbox_event"."relayed_at" IS NULL;